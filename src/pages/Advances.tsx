// Cash advances: money given to processors and riders, the receipts that liquidate it, cash returned,
// and what is still held. Billable receipts go to the shipment's billing in one click, once.
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { dayLabel, today } from "../lib/types";
import { money, peso } from "../lib/billing";
import { shrinkPhoto } from "../lib/photo";
import { COST_KINDS, COST_LABEL, LIQUIDATE_WITHIN_DAYS, daysOpen, sumsOf, type Advance, type AdvanceLine, type CostKind } from "../lib/advances";

const num = (v: string) => Number(v.replace(/,/g, ""));

/** The shipment id for a typed PN, or an error message. */
async function findJob(pn: string): Promise<{ id: string | null; error?: string }> {
  const p = pn.trim().toUpperCase();
  if (!p) return { id: null };
  const { data } = await supabase.from("jobs").select("id, job_no").ilike("job_no", p).limit(2);
  if (!data?.length) return { id: null, error: `No shipment with PN ${p}.` };
  return { id: data[0].id as string };
}

export default function Advances() {
  const { profile } = useAuth();
  const canGive = profile?.role === "owner" || profile?.role === "billing";
  const [params, setParams] = useSearchParams();
  const openId = Number(params.get("id")) || null;
  const [advances, setAdvances] = useState<Advance[] | null>(null);
  const [lines, setLines] = useState<AdvanceLine[]>([]);
  const [showClosed, setShowClosed] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const [a, l] = await Promise.all([
      supabase.from("cash_advances").select("*, jobs(job_no)").order("given_on", { ascending: false }).order("id", { ascending: false }).limit(500),
      supabase.from("advance_lines").select("*, jobs(job_no)").order("spent_on").order("id").limit(5000),
    ]);
    if (a.error || l.error) setError((a.error ?? l.error)!.message);
    setAdvances((a.data as Advance[]) ?? []);
    setLines((l.data as AdvanceLine[]) ?? []);
  }, []);
  useEffect(() => { load(); }, [load]);

  const rows = useMemo(() => (advances ?? []).map((a) => ({ a, s: sumsOf(a, lines.filter((l) => l.advance_id === a.id)) })), [advances, lines]);
  const open = rows.filter((r) => r.a.status === "open");
  const shown = showClosed ? rows : open;
  const now = today();
  const held = open.reduce((s, r) => s + Math.max(0, r.s.balance), 0);
  const owed = open.reduce((s, r) => s + Math.max(0, -r.s.balance), 0);
  const unbilled = rows.reduce((s, r) => s + r.s.unbilled, 0);
  const late = open.filter((r) => daysOpen(r.a.given_on, now) > LIQUIDATE_WITHIN_DAYS && r.s.balance > 0).length;
  const current = rows.find((r) => r.a.id === openId);

  return (
    <>
      <h1>Cash advances</h1>
      {error && <p className="error">{error}</p>}
      <section className="card">
        <div className="tiles">
          <div className="tile main"><span>Cash held by staff</span><strong>{peso(held)}</strong></div>
          <div className="tile"><span>Spent, not yet billed to clients</span><strong className={unbilled > 0 ? "warn-num" : ""}>{peso(unbilled)}</strong></div>
          <div className="tile"><span>Owed back to staff</span><strong>{peso(owed)}</strong></div>
          <div className="tile"><span>Open over {LIQUIDATE_WITHIN_DAYS} days</span><strong className={late ? "warn-num" : ""}>{late}</strong></div>
        </div>
        <p className="muted small">An advance stays open until every peso is liquidated with receipts or returned. Spent receipts for a shipment go to its billing with Add to billing.</p>
      </section>

      {current && <AdvanceCard row={current} lines={lines.filter((l) => l.advance_id === current.a.id)} canGive={canGive} onChange={load} onClose={() => setParams({})} />}

      {canGive && <NewAdvance onSaved={(id) => { load(); setParams({ id: String(id) }); }} />}

      <section className="card">
        <div className="row spread wrap">
          <h2>{showClosed ? "All advances" : "Open advances"} <span className="count">{shown.length}</span></h2>
          <label className="check"><input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} /> Show closed</label>
        </div>
        {advances === null ? <p className="muted">Loading…</p> : shown.length === 0 ? <p className="muted">No open advances.</p> : (
          <div className="table-scroll">
            <table className="small">
              <thead><tr><th>Given</th><th>To</th><th>For</th><th>PN</th><th className="num">Given</th><th className="num">Spent</th><th className="num">Returned</th><th className="num">Still held</th><th>Status</th></tr></thead>
              <tbody>
                {shown.map(({ a, s }) => {
                  const d = daysOpen(a.given_on, now);
                  return (
                    <tr key={a.id} className={a.id === openId ? "selected" : ""}>
                      <td className="nowrap"><button type="button" className="link" onClick={() => setParams({ id: String(a.id) })}>{dayLabel(a.given_on)}</button></td>
                      <td>{a.person_name}</td><td>{a.purpose}</td>
                      <td className="nowrap">{a.jobs?.job_no && <Link to={`/jobs/${a.job_id}`}>{a.jobs.job_no}</Link>}</td>
                      <td className="num">{money(s.given)}</td><td className="num">{money(s.spent)}</td><td className="num">{money(s.returned)}</td>
                      <td className={"num " + (s.balance < 0 ? "error" : "")}><strong>{money(s.balance)}</strong></td>
                      <td className="nowrap">{a.status === "closed" ? <span className="badge">Closed</span>
                        : d > LIQUIDATE_WITHIN_DAYS && s.balance > 0 ? <span className="alert-chip overdue">Open {d} days</span> : <span className="badge">Open</span>}
                        {s.unbilled > 0 && <span className="alert-chip soon" title="Spent on a shipment, not yet on its billing">₱ to bill</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

function NewAdvance({ onSaved }: { onSaved: (id: number) => void }) {
  const [people, setPeople] = useState<{ name: string; profile_id: string | null }[]>([]);
  const [f, setF] = useState({ person: "", amount: "", purpose: "", pn: "", given_on: today() });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    Promise.all([
      supabase.from("profiles").select("id, full_name, email, role").not("role", "in", "(pending)"),
      supabase.from("riders").select("name, profile_id").eq("active", true),
    ]).then(([p, r]) => {
      const staff = ((p.data ?? []) as { id: string; full_name: string | null; email: string }[]).map((x) => ({ name: x.full_name || x.email, profile_id: x.id }));
      const riders = ((r.data ?? []) as { name: string; profile_id: string | null }[]).filter((x) => !staff.some((s) => s.profile_id === x.profile_id && x.profile_id));
      setPeople([...staff, ...riders].sort((a, b) => a.name.localeCompare(b.name)));
    });
  }, []);
  async function save(e: FormEvent) {
    e.preventDefault(); setError("");
    const amount = num(f.amount);
    if (!f.person.trim()) { setError("Who is the money for?"); return; }
    if (!(amount > 0)) { setError("Enter the amount given."); return; }
    setBusy(true);
    const job = await findJob(f.pn);
    if (job.error) { setBusy(false); setError(job.error); return; }
    const who = people.find((p) => p.name === f.person.trim());
    const { data, error } = await supabase.from("cash_advances").insert({
      person_name: f.person.trim(), profile_id: who?.profile_id ?? null, amount, purpose: f.purpose.trim() || null, job_id: job.id, given_on: f.given_on,
    }).select("id").single();
    setBusy(false);
    if (error) { setError(error.message); return; }
    setF({ person: "", amount: "", purpose: "", pn: "", given_on: today() });
    onSaved((data as { id: number }).id);
  }
  return (
    <details className="card">
      <summary><strong>Give a cash advance</strong></summary>
      <form onSubmit={save}>
        <datalist id="adv-people">{people.map((p) => <option key={p.name + (p.profile_id ?? "")} value={p.name} />)}</datalist>
        <div className="grid">
          <label>To (staff or rider)<input list="adv-people" value={f.person} onChange={(e) => setF({ ...f, person: e.target.value })} required /></label>
          <label>Amount (₱)<input inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} required /></label>
          <label>Date given<input type="date" value={f.given_on} max={today()} onChange={(e) => setF({ ...f, given_on: e.target.value })} /></label>
          <label>For<input value={f.purpose} maxLength={300} onChange={(e) => setF({ ...f, purpose: e.target.value })} placeholder="e.g. duties and arrastre" /></label>
          <label>Shipment PN (optional)<input value={f.pn} onChange={(e) => setF({ ...f, pn: e.target.value })} placeholder="e.g. HNC11-810-26" /></label>
        </div>
        {error && <p className="error" role="alert">{error}</p>}
        <button disabled={busy}>{busy ? "Saving…" : "Save advance"}</button>
      </form>
    </details>
  );
}

function AdvanceCard({ row, lines, canGive, onChange, onClose }: {
  row: { a: Advance; s: ReturnType<typeof sumsOf> }; lines: AdvanceLine[]; canGive: boolean; onChange: () => void; onClose: () => void;
}) {
  const { profile } = useAuth();
  const { a, s } = row;
  const holder = a.profile_id === profile?.id;
  const canAdd = a.status === "open" && (canGive || holder);
  const [f, setF] = useState({ kind: "spent" as "spent" | "returned" | "reimbursed", pn: a.jobs?.job_no ?? "", cost_kind: "arrastre" as CostKind, description: "", receipt_no: "", amount: "", billable: true, spent_on: today() });
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  async function add(e: FormEvent) {
    e.preventDefault(); setError("");
    const amount = num(f.amount);
    if (!(amount > 0)) { setError("Enter the amount."); return; }
    setBusy("Saving…");
    const job = f.kind === "spent" ? await findJob(f.pn) : { id: null };
    if ("error" in job && job.error) { setBusy(""); setError(job.error); return; }
    let photo: string | null = null;
    if (file) {
      const blob = file.type.startsWith("image/") ? await shrinkPhoto(file) : file;
      photo = `${a.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${file.type.startsWith("image/") ? "jpg" : "pdf"}`;
      const up = await supabase.storage.from("advance-files").upload(photo, blob, { contentType: file.type.startsWith("image/") ? "image/jpeg" : file.type });
      if (up.error) { setBusy(""); setError(up.error.message); return; }
    }
    const row: Record<string, unknown> = f.kind !== "spent"
      ? { advance_id: a.id, kind: f.kind, amount, spent_on: f.spent_on, description: f.description.trim() || null, photo_path: photo }
      : { advance_id: a.id, kind: "spent", job_id: job.id, cost_kind: f.cost_kind, description: f.description.trim() || null, receipt_no: f.receipt_no.trim() || null,
          amount, billable: f.billable, spent_on: f.spent_on, photo_path: photo };
    const { error } = await supabase.from("advance_lines").insert(row);
    if (error) { if (photo) await supabase.storage.from("advance-files").remove([photo]); setBusy(""); setError(error.message); return; }
    setBusy(""); setFile(null); setF({ ...f, description: "", receipt_no: "", amount: "" }); onChange();
  }
  async function act(label: string, run: () => PromiseLike<{ error: { message: string } | null }>) {
    setBusy(label); setError("");
    const { error } = await run();
    setBusy("");
    if (error) setError(error.message); else onChange();
  }
  async function view(path: string) {
    const { data, error } = await supabase.storage.from("advance-files").createSignedUrl(path, 300);
    if (error || !data) setError(error?.message ?? "Could not open the file."); else window.open(data.signedUrl, "_blank", "noopener");
  }

  return (
    <section className="card advance-card">
      <div className="row spread wrap">
        <h2>{a.person_name} · {peso(s.given)} on {dayLabel(a.given_on)}</h2>
        <div className="row no-print">
          <button type="button" className="ghost small" onClick={() => window.print()}>Print liquidation</button>
          <button type="button" className="ghost small" onClick={onClose}>Close</button>
        </div>
      </div>
      <p className="small">{a.purpose}{a.jobs?.job_no && <> · PN <Link to={`/jobs/${a.job_id}`}>{a.jobs.job_no}</Link></>}{a.status === "closed" && <> · <span className="badge">Closed</span></>}</p>
      <div className="tiles">
        <div className="tile"><span>Given</span><strong>{peso(s.given)}</strong></div>
        <div className="tile"><span>Spent (receipts)</span><strong>{peso(s.spent)}</strong></div>
        <div className="tile"><span>Cash returned</span><strong>{peso(s.returned)}</strong></div>
        <div className="tile main"><span>{s.balance >= 0 ? "Still held" : "Office owes"}</span><strong className={s.balance < 0 ? "warn-num" : ""}>{peso(Math.abs(s.balance))}</strong></div>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      {s.needsPn > 0 && <p className="warn">{s.needsPn} billable receipt(s) have no shipment yet; they cannot be billed until a PN is chosen.</p>}

      <div className="table-scroll">
        <table className="small">
          <thead><tr><th>Date</th><th>What</th><th>PN</th><th>Details</th><th>OR / receipt</th><th className="num">Amount</th><th>Billing</th><th className="no-print"></th></tr></thead>
          <tbody>
            {lines.length === 0 && <tr><td colSpan={8} className="muted">No receipts yet.</td></tr>}
            {lines.map((l) => (
              <tr key={l.id}>
                <td className="nowrap">{dayLabel(l.spent_on)}</td>
                <td>{l.kind === "returned" ? "Cash returned" : l.kind === "reimbursed" ? "Office paid back" : COST_LABEL[l.cost_kind!]}</td>
                <td className="nowrap">{l.jobs?.job_no && <Link to={`/jobs/${l.job_id}`}>{l.jobs.job_no}</Link>}</td>
                <td>{l.description}{l.photo_path && <> <button type="button" className="link small no-print" onClick={() => view(l.photo_path!)}>photo</button></>}</td>
                <td>{l.receipt_no}</td>
                <td className="num">{money(Number(l.amount))}</td>
                <td className="nowrap">{l.kind !== "spent" ? "" : !l.billable ? <span className="muted">Office cost</span>
                  : l.charge_id ? <span className="badge">On billing</span>
                  : !l.job_id ? <span className="warn">Needs PN</span>
                  : canGive ? <button type="button" className="small" disabled={!!busy} onClick={() => act("Billing…", () => supabase.rpc("bill_advance_line", { p_line: l.id }))}>Add to billing</button>
                  : <span className="muted">Not billed yet</span>}</td>
                <td className="no-print">{a.status === "open" && !l.charge_id && (canGive || (holder && l.created_by === profile?.id)) &&
                  <button type="button" className="link danger-text small" disabled={!!busy} onClick={() => confirm("Remove this line?") && act("Removing…", async () => {
                    const r = await supabase.from("advance_lines").delete().eq("id", l.id);
                    if (!r.error && l.photo_path) await supabase.storage.from("advance-files").remove([l.photo_path]);
                    return r;
                  })}>Remove</button>}</td>
              </tr>
            ))}
          </tbody>
          {lines.length > 0 && <tfoot><tr><td colSpan={5}>Total liquidated</td><td className="num"><strong>{money(s.spent + s.returned)}</strong></td><td colSpan={2}></td></tr></tfoot>}
        </table>
      </div>

      {canAdd && (
        <form className="no-print" onSubmit={add}>
          <h3>Add a receipt or cash returned</h3>
          <div className="grid">
            <label>What
              <select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as "spent" | "returned" | "reimbursed" })}>
                <option value="spent">Spent (receipt)</option><option value="returned">Cash returned to the office</option>
                {canGive && <option value="reimbursed">Office paid back the staff member</option>}
              </select>
            </label>
            {f.kind === "spent" && <>
              <label>Cost<select value={f.cost_kind} onChange={(e) => setF({ ...f, cost_kind: e.target.value as CostKind })}>{COST_KINDS.map((k) => <option key={k} value={k}>{COST_LABEL[k]}</option>)}</select></label>
              <label>Shipment PN<input value={f.pn} onChange={(e) => setF({ ...f, pn: e.target.value })} placeholder="e.g. HNC11-810-26" /></label>
              <label>OR / receipt no.<input value={f.receipt_no} maxLength={60} onChange={(e) => setF({ ...f, receipt_no: e.target.value })} /></label>
            </>}
            <label>Amount (₱)<input inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} required /></label>
            <label>Date<input type="date" value={f.spent_on} max={today()} onChange={(e) => setF({ ...f, spent_on: e.target.value })} /></label>
            <label>Details<input value={f.description} maxLength={200} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder={f.kind === "spent" ? "e.g. Maersk DO fee" : "optional"} /></label>
            <label>Receipt photo or PDF<input type="file" accept="image/*,application/pdf" capture="environment" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></label>
            {f.kind === "spent" && <label className="check"><input type="checkbox" checked={f.billable} onChange={(e) => setF({ ...f, billable: e.target.checked })} /> Bill to the client (untick for office costs such as parking)</label>}
          </div>
          <button disabled={!!busy}>{busy || "Add"}</button>
        </form>
      )}
      {canGive && (
        <div className="row no-print" style={{ marginTop: 10 }}>
          {a.status === "open"
            ? <button type="button" className="ghost" disabled={!!busy || s.balance !== 0} title={s.balance !== 0 ? "Close when nothing is held or owed" : ""}
                onClick={() => act("Closing…", () => supabase.from("cash_advances").update({ status: "closed" }).eq("id", a.id))}>Close advance</button>
            : <button type="button" className="ghost" disabled={!!busy} onClick={() => act("Reopening…", () => supabase.from("cash_advances").update({ status: "open" }).eq("id", a.id))}>Reopen</button>}
          {a.status === "open" && s.balance !== 0 && <span className="muted small">It can be closed when the balance is zero: liquidate or return the rest{s.balance < 0 ? ", or record the office paying the staff member back" : ""}.</span>}
        </div>
      )}
      <div className="print-only sign-lines">
        <div><span className="line" />Liquidated by: {a.person_name}</div>
        <div><span className="line" />Checked by</div>
      </div>
    </section>
  );
}
