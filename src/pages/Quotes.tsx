// Quotations: build a quote from the standard fees, print it on the letterhead, track sent / accepted /
// declined, and turn an accepted quote into a shipment (or add it to one) with its charges filled in.
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { dayLabel, pretty, today } from "../lib/types";
import { CHARGE_KINDS, CHARGE_LABEL, money, peso, vatOf, type ChargeKind } from "../lib/billing";
import { DEFAULT_TERMS, QUOTE_STATUS_LABEL, VALID_DAYS, cleanLine, isExpired, quoteFor, quoteTotals, type Quote, type QuoteLine, type StandardFee } from "../lib/quotes";

const plusDays = (d: string, n: number) => new Date(Date.parse(d) + n * 86400000).toISOString().slice(0, 10);
const blankLine = (): QuoteLine => ({ kind: "brokerage_fee", description: "", amount: 0, vatable: true, advance: false });
type Client = { id: string; name: string; email: string | null };

export default function Quotes() {
  const { id } = useParams();
  return id ? <QuoteEditor id={id} /> : <QuoteList />;
}

// ---------- List and standard fees ----------

function QuoteList() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const canWrite = ["owner", "billing", "processor"].includes(profile?.role ?? "");
  const [quotes, setQuotes] = useState<Quote[] | null>(null);
  const [error, setError] = useState("");
  const now = today();
  useEffect(() => {
    supabase.from("quotations").select("*, clients(name, email, address), jobs(job_no)").order("id", { ascending: false }).limit(300)
      .then(({ data, error }) => { if (error) setError(error.message); setQuotes((data as Quote[]) ?? []); });
  }, []);
  return (
    <>
      <div className="row spread wrap">
        <h1>Quotations</h1>
        {canWrite && <button type="button" onClick={() => navigate("/quotes/new")}>New quotation</button>}
      </div>
      {error && <p className="error">{error}</p>}
      <section className="card">
        {quotes === null ? <p className="muted">Loading…</p> : quotes.length === 0 ? <p className="muted">No quotations yet.</p> : (
          <div className="table-scroll">
            <table className="small">
              <thead><tr><th>No.</th><th>Date</th><th>For</th><th>Cargo</th><th className="num">Total</th><th>Valid until</th><th>Status</th><th>Shipment</th></tr></thead>
              <tbody>
                {quotes.map((q) => (
                  <tr key={q.id}>
                    <td><Link to={`/quotes/${q.id}`}>{q.quote_no}</Link></td><td className="nowrap">{dayLabel(q.created_at.slice(0, 10))}</td>
                    <td>{quoteFor(q)}{!q.client_id && <span className="muted"> (prospect)</span>}</td><td>{q.cargo}</td>
                    <td className="num">{money(quoteTotals(q.lines).total)}</td><td className="nowrap">{dayLabel(q.valid_until)}</td>
                    <td>{isExpired(q, now) ? <span className="alert-chip overdue">Expired</span> : <span className={"badge quote-" + q.status}>{QUOTE_STATUS_LABEL[q.status]}</span>}</td>
                    <td>{q.jobs?.job_no && <Link to={`/jobs/${q.job_id}`}>{q.jobs.job_no}</Link>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <StandardFees />
    </>
  );
}

function StandardFees() {
  const { profile } = useAuth();
  const isOwner = profile?.role === "owner";
  const [fees, setFees] = useState<StandardFee[]>([]);
  const [f, setF] = useState({ name: "", kind: "brokerage_fee" as ChargeKind, amount: "", vatable: true, advance: false });
  const [error, setError] = useState("");
  const load = useCallback(() => supabase.from("standard_fees").select("*").order("sort").order("id").then(({ data }) => setFees((data as StandardFee[]) ?? [])), []);
  useEffect(() => { load(); }, [load]);
  async function add(e: FormEvent) {
    e.preventDefault(); setError("");
    const amount = Number(f.amount.replace(/,/g, ""));
    if (!f.name.trim() || !(amount >= 0) || f.amount.trim() === "") { setError("Enter the fee's name and amount."); return; }
    const { error } = await supabase.from("standard_fees").insert({ name: f.name.trim(), kind: f.kind, amount, vatable: f.vatable && !f.advance, advance: f.advance, sort: fees.length });
    if (error) { setError(error.message); return; }
    setF({ ...f, name: "", amount: "" }); load();
  }
  async function update(fee: StandardFee, patch: Partial<StandardFee>) {
    const { error } = await supabase.from("standard_fees").update(patch).eq("id", fee.id);
    if (error) setError(error.message); load();
  }
  async function remove(fee: StandardFee) {
    if (!confirm(`Remove ${fee.name} from the standard fees?`)) return;
    const { error } = await supabase.from("standard_fees").delete().eq("id", fee.id);
    if (error) setError(error.message); load();
  }
  return (
    <section className="card">
      <h2>Standard fees <span className="count">{fees.length}</span></h2>
      <p className="muted small">The fees offered when building a quotation; each can still be changed on the quote. {!isOwner && "Only the owner can change this list."}</p>
      {error && <p className="error" role="alert">{error}</p>}
      {fees.length > 0 && (
        <table className="small">
          <thead><tr><th>Fee</th><th>Type</th><th className="num">Amount (₱)</th><th>VAT</th><th>Advance</th><th></th></tr></thead>
          <tbody>
            {fees.map((fee) => (
              <tr key={fee.id}>
                <td>{fee.name}</td><td>{CHARGE_LABEL[fee.kind]}</td>
                <td className="num"><input key={`${fee.id}-${fee.amount}`} defaultValue={String(Number(fee.amount))} disabled={!isOwner} inputMode="decimal" style={{ width: "8em" }} aria-label={`${fee.name} amount`}
                  onBlur={(e) => { const v = Number(e.target.value.replace(/,/g, "")); if (v >= 0 && v !== Number(fee.amount)) update(fee, { amount: v }); }} /></td>
                <td>{fee.vatable ? "+ 12%" : ""}</td><td>{fee.advance ? "Yes" : ""}</td>
                <td>{isOwner && <button type="button" className="link danger-text small" onClick={() => remove(fee)}>Remove</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {isOwner && (
        <form className="row wrap" onSubmit={add} style={{ marginTop: 10 }}>
          <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Brokerage fee (formal entry)" aria-label="Fee name" />
          <select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as ChargeKind })} aria-label="Fee type">{CHARGE_KINDS.map((k) => <option key={k} value={k}>{CHARGE_LABEL[k]}</option>)}</select>
          <input value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} placeholder="Amount ₱" inputMode="decimal" style={{ width: "8em" }} aria-label="Amount" />
          <label className="check"><input type="checkbox" checked={f.vatable && !f.advance} disabled={f.advance} onChange={(e) => setF({ ...f, vatable: e.target.checked })} /> + VAT</label>
          <label className="check"><input type="checkbox" checked={f.advance} onChange={(e) => setF({ ...f, advance: e.target.checked })} /> Advance (billed at cost)</label>
          <button>Add fee</button>
        </form>
      )}
    </section>
  );
}

// ---------- One quotation ----------

function QuoteEditor({ id }: { id: string }) {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const isNew = id === "new";
  const canWrite = ["owner", "billing", "processor"].includes(profile?.role ?? "");
  const canAccept = profile?.role === "owner" || profile?.role === "billing";
  const [q, setQ] = useState<Quote | null>(null);
  const [clients, setClients] = useState<Client[]>([]);
  const [fees, setFees] = useState<StandardFee[]>([]);
  const [seller, setSeller] = useState<{ registered_name: string | null; trade_name: string | null; address: string | null; tin: string | null } | null>(null);
  const [form, setForm] = useState({ who: "", prospect_name: "", prospect_email: "", service_type: "brokerage" as Quote["service_type"], cargo: "", route: "",
    valid_until: plusDays(today(), VALID_DAYS), terms: DEFAULT_TERMS, lines: [blankLine()] });
  const [attachPn, setAttachPn] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    const [c, f, s] = await Promise.all([
      supabase.from("clients").select("id, name, email").order("name"),
      supabase.from("standard_fees").select("*").order("sort").order("id"),
      supabase.from("bir_settings").select("registered_name, trade_name, address, tin").maybeSingle(),
    ]);
    setClients((c.data as Client[]) ?? []); setFees((f.data as StandardFee[]) ?? []); setSeller(s.data as typeof seller);
    if (isNew) return;
    const { data, error } = await supabase.from("quotations").select("*, clients(name, email, address), jobs(job_no)").eq("id", Number(id)).maybeSingle();
    if (error || !data) { setError(error?.message ?? "Quotation not found."); return; }
    const x = data as Quote;
    setQ(x);
    setForm({ who: x.client_id ?? "__prospect__", prospect_name: x.prospect_name ?? "", prospect_email: x.prospect_email ?? "", service_type: x.service_type,
      cargo: x.cargo ?? "", route: x.route ?? "", valid_until: x.valid_until ?? "", terms: x.terms ?? "", lines: x.lines.length ? x.lines : [blankLine()] });
  }, [id, isNew]);
  useEffect(() => { load(); }, [load]);

  const locked = !canWrite || q?.status === "accepted";
  const lines = form.lines.filter((l) => l.description.trim() || Number(l.amount) > 0).map(cleanLine);
  const t = useMemo(() => quoteTotals(lines), [lines]);
  const setLine = (i: number, patch: Partial<QuoteLine>) => setForm({ ...form, lines: form.lines.map((l, k) => (k === i ? { ...l, ...patch } : l)) });
  const prospect = form.who === "__prospect__";
  const client = clients.find((c) => c.id === form.who);
  const forName = prospect ? form.prospect_name : client?.name ?? "";

  async function save(e?: FormEvent) {
    e?.preventDefault(); setError(""); setNotice("");
    if (!form.who) { setError("Choose the client, or New prospect."); return null; }
    if (prospect && !form.prospect_name.trim()) { setError("Enter the prospect's name."); return null; }
    if (!lines.length) { setError("Add at least one line with an amount."); return null; }
    const row = {
      client_id: prospect ? null : form.who, prospect_name: prospect ? form.prospect_name.trim() : null, prospect_email: prospect ? form.prospect_email.trim() || null : null,
      service_type: form.service_type, cargo: form.cargo.trim() || null, route: form.route.trim() || null, lines, valid_until: form.valid_until || null, terms: form.terms.trim() || null,
    };
    setBusy("Saving…");
    const res = isNew ? await supabase.from("quotations").insert(row).select("id").single() : await supabase.from("quotations").update(row).eq("id", Number(id)).select("id").single();
    setBusy("");
    if (res.error) { setError(res.error.message); return null; }
    const newId = (res.data as { id: number }).id;
    if (isNew) navigate(`/quotes/${newId}`, { replace: true }); else { setNotice("Saved."); await load(); }
    return newId;
  }
  async function setStatus(status: "sent" | "declined" | "draft") {
    setBusy("Saving…"); setError("");
    const { error } = await supabase.from("quotations").update({ status }).eq("id", Number(id));
    setBusy(""); if (error) setError(error.message); else load();
  }
  async function accept(existing: boolean) {
    setError(""); setNotice("");
    let job: string | null = null;
    if (existing) {
      const { data } = await supabase.from("jobs").select("id").ilike("job_no", attachPn.trim()).limit(1);
      if (!data?.length) { setError(`No shipment with PN ${attachPn.trim()}.`); return; }
      job = data[0].id as string;
    }
    if (!confirm(existing ? `Add this quotation's ${lines.length} line(s) to the billing of ${attachPn.trim().toUpperCase()}?` : `Create a new shipment for ${forName} with this quotation's ${lines.length} line(s) on its billing?`)) return;
    setBusy("Accepting…");
    const { data, error } = await supabase.rpc("accept_quotation", { p_quote: Number(id), p_job: job });
    setBusy("");
    if (error) { setError(error.message); return; }
    navigate(`/jobs/${data as string}`);
  }

  if (!isNew && !q && !error) return <p className="muted">Loading…</p>;
  const sellerName = seller?.trade_name || seller?.registered_name || "VSA Customs Brokerage";

  return (
    <>
      <p className="no-print"><Link to="/quotes">← Quotations</Link></p>
      <div className="row spread wrap no-print">
        <h1>{isNew ? "New quotation" : `Quotation ${q?.quote_no}`} {q && <span className={"badge quote-" + q.status}>{QUOTE_STATUS_LABEL[q.status]}</span>}</h1>
        {q && <button type="button" className="ghost" onClick={() => window.print()}>Print</button>}
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      {notice && <p className="ok" role="status">{notice}</p>}
      {q?.status === "accepted" && <p className="ok no-print">Accepted: shipment <Link to={`/jobs/${q.job_id}`}>{q.jobs?.job_no}</Link> was made with these charges.</p>}

      <form className="card no-print" onSubmit={save}>
        <fieldset disabled={locked} className="plain">
          <div className="grid">
            <label>For
              <select value={form.who} onChange={(e) => setForm({ ...form, who: e.target.value })} required>
                <option value="">Choose…</option>
                <option value="__prospect__">New prospect (not yet a client)</option>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
            {prospect && <>
              <label>Prospect name<input value={form.prospect_name} maxLength={160} onChange={(e) => setForm({ ...form, prospect_name: e.target.value })} /></label>
              <label>Prospect email<input type="email" value={form.prospect_email} onChange={(e) => setForm({ ...form, prospect_email: e.target.value })} /></label>
            </>}
            <label>Service<select value={form.service_type} onChange={(e) => setForm({ ...form, service_type: e.target.value as Quote["service_type"] })}>
              {(["brokerage", "forwarding", "trucking"] as const).map((s) => <option key={s} value={s}>{pretty(s)}</option>)}</select></label>
            <label>Cargo<input value={form.cargo} maxLength={300} onChange={(e) => setForm({ ...form, cargo: e.target.value })} placeholder="e.g. 1 x 40' frozen chicken MDM" /></label>
            <label>Route / delivery<input value={form.route} maxLength={200} onChange={(e) => setForm({ ...form, route: e.target.value })} placeholder="e.g. Manila port to Valenzuela" /></label>
            <label>Valid until<input type="date" value={form.valid_until} onChange={(e) => setForm({ ...form, valid_until: e.target.value })} /></label>
          </div>

          <h3>Lines</h3>
          <div className="table-scroll">
            <table className="small quote-lines">
              <thead><tr><th>Type</th><th>Description</th><th className="num">Amount (₱)</th><th>VAT</th><th>Advance</th><th></th></tr></thead>
              <tbody>
                {form.lines.map((l, i) => (
                  <tr key={i}>
                    <td><select value={l.kind} onChange={(e) => setLine(i, { kind: e.target.value as ChargeKind })} aria-label={`Line ${i + 1} type`}>{CHARGE_KINDS.map((k) => <option key={k} value={k}>{CHARGE_LABEL[k]}</option>)}</select></td>
                    <td><input value={l.description} maxLength={200} onChange={(e) => setLine(i, { description: e.target.value })} aria-label={`Line ${i + 1} description`} /></td>
                    <td className="num"><input value={l.amount ? String(l.amount) : ""} inputMode="decimal" style={{ width: "9em" }} aria-label={`Line ${i + 1} amount`}
                      onChange={(e) => setLine(i, { amount: Number(e.target.value.replace(/,/g, "")) || 0 })} /></td>
                    <td><input type="checkbox" checked={l.vatable && !l.advance} disabled={l.advance} onChange={(e) => setLine(i, { vatable: e.target.checked })} aria-label={`Line ${i + 1} VAT`} /></td>
                    <td><input type="checkbox" checked={l.advance} onChange={(e) => setLine(i, { advance: e.target.checked, vatable: e.target.checked ? false : l.vatable })} aria-label={`Line ${i + 1} advance`} /></td>
                    <td><button type="button" className="link danger-text small" onClick={() => setForm({ ...form, lines: form.lines.length > 1 ? form.lines.filter((_, k) => k !== i) : [blankLine()] })}>Remove</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="quote-running">Services {peso(t.services)} · VAT {peso(t.vat)}{t.advances > 0 && ` · Advances ${peso(t.advances)}`} · <strong>Estimated total {peso(t.total)}</strong></p>
          <div className="row wrap">
            {fees.length > 0 && (
              <select value="" aria-label="Add a standard fee" onChange={(e) => {
                const fee = fees.find((x) => String(x.id) === e.target.value);
                if (!fee) return;
                const rest = form.lines.filter((l) => l.description.trim() || Number(l.amount) > 0);
                setForm({ ...form, lines: [...rest, { kind: fee.kind, description: fee.name, amount: Number(fee.amount), vatable: fee.vatable, advance: fee.advance }] });
              }}>
                <option value="">+ Add a standard fee…</option>
                {fees.map((fee) => <option key={fee.id} value={fee.id}>{fee.name} · {peso(Number(fee.amount))}</option>)}
              </select>
            )}
            <button type="button" className="ghost" onClick={() => setForm({ ...form, lines: [...form.lines, blankLine()] })}>+ Add a line</button>
            {!isNew && q?.status !== "accepted" && <Link to={q?.job_id ? `/duties/${q.job_id}` : "/duties"} className="small">Work out duties and taxes on the Duties page</Link>}
          </div>
          <label>Terms<textarea rows={4} maxLength={1500} value={form.terms} onChange={(e) => setForm({ ...form, terms: e.target.value })} /></label>
          {!locked && <button disabled={!!busy}>{busy || (isNew ? "Save quotation" : "Save changes")}</button>}
        </fieldset>
      </form>

      {q && q.status !== "accepted" && canWrite && (
        <section className="card no-print">
          <h2>Next step</h2>
          <div className="row wrap">
            {q.status === "draft" && <button type="button" className="ghost" disabled={!!busy} onClick={() => setStatus("sent")}>Mark as sent</button>}
            {q.status !== "declined" && <button type="button" className="ghost" disabled={!!busy} onClick={() => setStatus("declined")}>Mark as declined</button>}
            {q.status === "declined" && <button type="button" className="ghost" disabled={!!busy} onClick={() => setStatus("draft")}>Back to draft</button>}
          </div>
          {canAccept && q.status !== "declined" && (
            <div className="row wrap" style={{ marginTop: 10 }}>
              <button type="button" disabled={!!busy} onClick={() => accept(false)}>Accepted: create the shipment</button>
              <span className="muted">or add to</span>
              <input value={attachPn} onChange={(e) => setAttachPn(e.target.value)} placeholder="existing PN" aria-label="Existing shipment PN" style={{ width: "11em" }} />
              <button type="button" className="ghost" disabled={!!busy || !attachPn.trim()} onClick={() => accept(true)}>Add to that shipment</button>
            </div>
          )}
          {!canAccept && <p className="muted small">The owner or billing staff accept a quotation, because it adds charges to the shipment.</p>}
        </section>
      )}

      {q && (
        <article className="quote-doc">
          <header className="quote-head">
            <div><strong className="quote-seller">{sellerName}</strong>{seller?.address && <div>{seller.address}</div>}{seller?.tin && <div>TIN {seller.tin}</div>}</div>
            <div className="quote-title"><h2>QUOTATION</h2><div>No. <strong>{q.quote_no}</strong></div><div>Date: {dayLabel(q.created_at.slice(0, 10))}</div>
              {q.valid_until && <div>Valid until: {dayLabel(q.valid_until)}</div>}</div>
          </header>
          <p><span className="muted">To:</span> <strong>{quoteFor(q)}</strong>{(q.clients?.address) && <><br />{q.clients.address}</>}</p>
          <p className="small">{pretty(q.service_type)}{q.cargo && ` · ${q.cargo}`}{q.route && ` · ${q.route}`}</p>
          <table className="quote-print-lines">
            <thead><tr><th>Description</th><th className="num">Amount (₱)</th><th className="num">VAT (₱)</th></tr></thead>
            <tbody>
              {q.lines.map(cleanLine).map((l, i) => (
                <tr key={i}><td>{l.description || CHARGE_LABEL[l.kind]}{l.advance && <span className="muted"> (advance, at cost)</span>}</td>
                  <td className="num">{money(l.amount)}</td><td className="num">{l.vatable ? money(vatOf(l)) : ""}</td></tr>
              ))}
            </tbody>
          </table>
          {(() => { const tt = quoteTotals(q.lines); return (
            <table className="quote-totals"><tbody>
              <tr><td>Services</td><td className="num">{money(tt.services)}</td></tr>
              <tr><td>VAT (12%)</td><td className="num">{money(tt.vat)}</td></tr>
              {tt.advances > 0 && <tr><td>Advances for the client (estimate, at cost)</td><td className="num">{money(tt.advances)}</td></tr>}
              <tr className="grand"><td>ESTIMATED TOTAL</td><td className="num">₱ {money(tt.total)}</td></tr>
            </tbody></table>); })()}
          {q.terms && <div className="quote-terms"><strong>Terms</strong>{q.terms.split("\n").map((line, i) => <p key={i}>{line}</p>)}</div>}
          <div className="sign-lines quote-sign"><div><span className="line" />{sellerName}</div><div><span className="line" />Conforme: {quoteFor(q)}</div></div>
        </article>
      )}
      {!isNew && (
        <p className="muted small no-print">Preview above: Print gives the client's copy. Saved changes show in it.</p>
      )}
    </>
  );
}
