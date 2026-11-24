// Collections: every shipment with a balance still to collect, grouped by client, with aging.
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../lib/auth";
import { PAYER_LABEL, TONE_LABEL, draftReminder, mailtoLink, payerScore, toneFor, type Tone } from "../lib/chase";
import { Link } from "react-router-dom";
import { fetchAll, supabase } from "../lib/supabase";
import { STATUS_LABEL, dayLabel, type Job } from "../lib/types";
import { AGE_LABEL, ageOf, dueDate, money, peso, totals, type AgeBucket, type Charge, type Payment, type Totals } from "../lib/billing";
import { today } from "../lib/types";

const BUCKETS: AgeBucket[] = ["current", "1-30", "31-60", "61-90", "90+"];
type Item = { job: Job; t: Totals; due: string | null; age: AgeBucket };
type Pay = Payment & { paid_on: string };
type Reminder = { id: number; client_id: string; sent_at: string; tone: Tone; total: number };
const daysFrom = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);

export default function Collections() {
  const [items, setItems] = useState<Item[] | null>(null);
  const [error, setError] = useState("");
  const [showPaid, setShowPaid] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pays, setPays] = useState<Pay[]>([]);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [instructions, setInstructions] = useState<string | null>(null);
  const [emails, setEmails] = useState<Record<string, string | null>>({});
  const [drafting, setDrafting] = useState<string | null>(null);
  const loadReminders = () => supabase.from("collection_reminders").select("id, client_id, sent_at, tone, total").order("sent_at", { ascending: false }).limit(500)
    .then(({ data }) => setReminders((data as Reminder[]) ?? []));

  useEffect(() => {
    (async () => {
      const [charges, payments] = await Promise.all([
        fetchAll<Charge>((a, b) => supabase.from("charges").select("job_id, amount, vatable, advance").order("id").range(a, b) as never),
        fetchAll<Pay>((a, b) => supabase.from("payments").select("job_id, amount, ewt_amount, paid_on").order("id").range(a, b) as never),
      ]);
      const ids = [...new Set(charges.map((c) => c.job_id))];
      const jobs: Job[] = [];
      for (let i = 0; i < ids.length; i += 150) {
        const { data, error } = await supabase.from("jobs").select("id, job_no, soa_no, billed_on, status, client_id, bl_awb_no, clients(name, payment_terms_days)").in("id", ids.slice(i, i + 150));
        if (error) throw new Error(error.message);
        jobs.push(...((data as unknown as Job[]) ?? []));
      }
      setPays(payments);
      const now = today();
      setItems(jobs.map((job) => {
        const t = totals(charges.filter((c) => c.job_id === job.id), payments.filter((p) => p.job_id === job.id));
        const due = dueDate(job.billed_on, job.clients?.payment_terms_days);
        return { job, t, due, age: t.balance > 0 ? ageOf(due, now) : "current" };
      }));
    })().catch((e: Error) => { setError(e.message); setItems([]); });
    loadReminders();
    supabase.from("bir_settings").select("payment_instructions").maybeSingle().then(({ data }) => setInstructions((data as { payment_instructions: string | null } | null)?.payment_instructions ?? null));
  }, []);
  // Client emails, for the reminder's "To".
  useEffect(() => {
    const ids = [...new Set((items ?? []).map((i) => i.job.client_id))];
    if (!ids.length) return;
    supabase.from("clients").select("id, email").in("id", ids.slice(0, 300)).then(({ data }) =>
      setEmails(Object.fromEntries(((data as { id: string; email: string | null }[]) ?? []).map((c) => [c.id, c.email]))));
  }, [items]);

  const shown = useMemo(() => (items ?? []).filter((i) => showPaid || i.t.balance > 0), [items, showPaid]);
  const byClient = useMemo(() => {
    const m = new Map<string, { name: string; items: Item[] }>();
    for (const i of shown) m.set(i.job.client_id, { name: i.job.clients?.name ?? "—", items: [...(m.get(i.job.client_id)?.items ?? []), i] });
    return [...m.entries()].map(([id, c]) => ({ id, ...c, balance: c.items.reduce((s, i) => s + i.t.balance, 0) }))
      .sort((a, b) => b.balance - a.balance || a.name.localeCompare(b.name));
  }, [shown]);
  const sum = (pred: (i: Item) => boolean) => shown.filter(pred).reduce((s, i) => s + Math.max(i.t.balance, 0), 0);

  async function download() {
    setBusy(true);
    try {
      const { default: writeExcelFile } = await import("write-excel-file/browser");
      const s = (v: string | null | undefined) => (v ? { value: v, type: String } : null);
      const n = (v: number) => ({ value: v, type: Number, format: "#,##0.00" });
      const d = (v: string | null) => (v ? { value: new Date(v + "T00:00:00Z"), type: Date, format: "yyyy-mm-dd" } : null);
      const cols: [string, number, (i: Item) => unknown][] = [
        ["Client", 30, (i) => s(i.job.clients?.name)], ["PN", 16, (i) => s(i.job.job_no)], ["SOA no.", 14, (i) => s(i.job.soa_no)],
        ["Billed on", 12, (i) => d(i.job.billed_on)], ["Due", 12, (i) => d(i.due)], ["Aging", 18, (i) => s(i.t.balance > 0 ? AGE_LABEL[i.age] : "Paid")],
        ["Total billed", 14, (i) => n(i.t.total)], ["Paid", 14, (i) => n(i.t.paid)], ["Balance", 14, (i) => n(i.t.balance)],
      ];
      const rows = byClient.flatMap((c) => c.items);
      const data = [cols.map(([h]) => ({ value: h, fontWeight: "bold" as const })), ...rows.map((i) => cols.map(([, , g]) => g(i)))];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await writeExcelFile(data as any, { columns: cols.map(([, w]) => ({ width: w })), stickyRowsCount: 1, sheet: "Collections" })
        .toFile(`VSA collections ${today()}.xlsx`);
    } catch (e) { setError(`Could not create the spreadsheet: ${(e as Error).message}`); }
    setBusy(false);
  }

  return (
    <>
      <div className="row spread">
        <h1>Collections</h1>
        <div className="row">
          <label className="check"><input type="checkbox" checked={showPaid} onChange={(e) => setShowPaid(e.target.checked)} /> Include fully paid</label>
          <button type="button" onClick={download} disabled={busy || !shown.length}>{busy ? "Preparing…" : "Download Excel"}</button>
        </div>
      </div>
      <p className="muted small">Balances from the charges and payments recorded on each shipment. Due date = billed date + the client's payment terms.</p>
      {error && <p className="error">{error}</p>}
      {items === null ? <p className="muted">Loading…</p> : (
        <>
          <div className="row stat-row">
            <span className="stat">To collect <strong>{peso(sum(() => true))}</strong></span>
            {BUCKETS.map((b) => <span key={b} className={"stat age-" + b}>{AGE_LABEL[b]} <strong>{peso(sum((i) => i.t.balance > 0 && i.age === b))}</strong></span>)}
          </div>
          {byClient.length === 0 ? <section className="card"><p className="ok">Nothing to collect. Charges added on a shipment's Billing section show here.</p></section> : (
            <section className="card">
              <table className="wide-table">
                <thead><tr><th>Client</th><th className="num">Shipments</th>{BUCKETS.map((b) => <th key={b} className="num">{AGE_LABEL[b]}</th>)}<th className="num">Balance</th></tr></thead>
                <tbody>
                  {byClient.map((c) => [
                    <tr key={c.id}>
                      <td><button type="button" className="link" onClick={() => setOpen(open === c.id ? null : c.id)}>{open === c.id ? "▾" : "▸"} {c.name}</button>
                        {c.items.some((i) => i.t.balance > 0 && i.age !== "current") && (
                          <button type="button" className="ghost small chase-btn" onClick={() => { setOpen(c.id); setDrafting(drafting === c.id ? null : c.id); }}>Draft reminder</button>
                        )}
                        {(() => { const last = reminders.find((r) => r.client_id === c.id); return last ? <div className="muted small">Last reminder {dayLabel(last.sent_at.slice(0, 10))}</div> : null; })()}
                      </td>
                      <td className="num">{c.items.length}</td>
                      {BUCKETS.map((b) => {
                        const v = c.items.filter((i) => i.t.balance > 0 && i.age === b).reduce((s, i) => s + i.t.balance, 0);
                        return <td key={b} className={"num " + (v && b !== "current" ? "age-" + b : "")}>{v ? money(v) : ""}</td>;
                      })}
                      <td className="num"><strong>{money(c.balance)}</strong></td>
                    </tr>,
                    open === c.id && (
                      <tr key={c.id + "-items"}><td colSpan={BUCKETS.length + 3}>
                        {drafting === c.id && (
                          <ChasePanel clientId={c.id} name={c.name} email={emails[c.id] ?? null} items={c.items} allItems={items ?? []} pays={pays}
                            reminders={reminders.filter((r) => r.client_id === c.id)} instructions={instructions} onInstructions={setInstructions}
                            onSent={() => { loadReminders(); }} onClose={() => setDrafting(null)} />
                        )}
                        <table className="small">
                          <thead><tr><th>PN</th><th>SOA no.</th><th>Billed on</th><th>Due</th><th>Step</th><th className="num">Billed</th><th className="num">Paid</th><th className="num">Balance</th><th></th></tr></thead>
                          <tbody>
                            {c.items.map((i) => (
                              <tr key={i.job.id}>
                                <td><Link to={`/jobs/${i.job.id}`}>{i.job.job_no}</Link></td><td>{i.job.soa_no}</td>
                                <td className="nowrap">{dayLabel(i.job.billed_on) ?? <span className="warn">Not billed yet</span>}</td>
                                <td className={"nowrap " + (i.t.balance > 0 && i.age !== "current" ? "error" : "")}>{dayLabel(i.due)}</td>
                                <td>{STATUS_LABEL[i.job.status]}</td>
                                <td className="num">{money(i.t.total)}</td><td className="num">{money(i.t.paid)}</td><td className="num"><strong>{money(i.t.balance)}</strong></td>
                                <td><Link to={`/jobs/${i.job.id}/soa`}>SOA</Link></td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </td></tr>
                    ),
                  ])}
                </tbody>
              </table>
            </section>
          )}
        </>
      )}
    </>
  );
}

/** A reminder for one client: tone from their payment history and the age of the debt; copy or open in email, then log it. */
function ChasePanel({ clientId, name, email, items, allItems, pays, reminders, instructions, onInstructions, onSent, onClose }: {
  clientId: string; name: string; email: string | null; items: Item[]; allItems: Item[]; pays: Pay[]; reminders: Reminder[];
  instructions: string | null; onInstructions: (v: string | null) => void; onSent: () => void; onClose: () => void;
}) {
  const { profile } = useAuth();
  const isOwner = profile?.role === "owner";
  const now = today();
  const overdue = items.filter((i) => i.t.balance > 0 && i.age !== "current" && i.due);
  const jobIds = new Set(allItems.filter((i) => i.job.client_id === clientId).map((i) => i.job.id));
  const mine = pays.filter((p) => jobIds.has(p.job_id));
  // Payment history: each fully paid billing of this client, its last payment date against its due date.
  const history = allItems.filter((i) => i.job.client_id === clientId && i.t.total > 0 && i.t.balance <= 0 && i.due)
    .map((i) => ({ due: i.due!, paidOn: mine.filter((p) => p.job_id === i.job.id).map((p) => p.paid_on).sort().pop() ?? i.due! }));
  const payer = payerScore(history);
  const maxDays = Math.max(0, ...overdue.map((i) => daysFrom(i.due!, now)));
  const [tone, setTone] = useState<Tone>(toneFor(payer, maxDays));
  const [to, setTo] = useState(email ?? "");
  const draft = draftReminder({
    client: name, tone, today: now, sender: profile?.full_name || profile?.email || "",
    paymentInstructions: instructions, withholdsTax: mine.some((p) => Number(p.ewt_amount) > 0),
    items: overdue.map((i) => ({ pn: i.job.job_no, soa: i.job.soa_no ?? null, billedOn: i.job.billed_on, due: i.due, daysOverdue: daysFrom(i.due!, now), balance: i.t.balance })),
  });
  const [subject, setSubject] = useState(draft.subject);
  const [body, setBody] = useState(draft.body);
  useEffect(() => { setSubject(draft.subject); setBody(draft.body); }, [tone, instructions]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (email && !to) setTo(email); }, [email]); // eslint-disable-line react-hooks/exhaustive-deps
  const [msg, setMsg] = useState("");
  const [editInstr, setEditInstr] = useState(false);
  const [instrText, setInstrText] = useState(instructions ?? "");
  const recentPay = mine.filter((p) => daysFrom(p.paid_on, now) <= 14).map((p) => p.paid_on).sort().pop();
  const lastReminder = reminders[0];
  const recentReminder = lastReminder && daysFrom(lastReminder.sent_at.slice(0, 10), now) < 7;
  const total = overdue.reduce((s, i) => s + i.t.balance, 0);

  async function copy() {
    try { await navigator.clipboard.writeText(`${subject}\n\n${body}`); setMsg("Copied. Paste it into your email or messaging app."); }
    catch { setMsg("Could not copy here; select the text and copy it."); }
  }
  async function logSent() {
    const { data: u } = await supabase.auth.getUser();
    const { error } = await supabase.from("collection_reminders").insert({ client_id: clientId, sent_by: u.user?.id, tone, total, pns: overdue.map((i) => i.job.job_no), to_email: to.trim() || null });
    if (error) { setMsg(error.message); return; }
    setMsg("Recorded as sent."); onSent();
  }
  async function saveInstructions() {
    const v = instrText.trim() || null;
    const { error } = await supabase.from("bir_settings").update({ payment_instructions: v }).eq("id", true);
    if (error) { setMsg(error.message); return; }
    onInstructions(v); setEditInstr(false); setMsg("Payment instructions saved for all reminders.");
  }

  return (
    <section className="chase card">
      <div className="row spread wrap">
        <h3>Reminder to {name} · {peso(total)} overdue</h3>
        <button type="button" className="ghost small" onClick={onClose}>Close</button>
      </div>
      {recentPay && <p className="warn" role="status">A payment was recorded on {dayLabel(recentPay)}. Check it is applied before sending.</p>}
      {recentReminder && <p className="warn" role="status">A reminder was already sent on {dayLabel(lastReminder.sent_at.slice(0, 10))}. Consider waiting a few more days.</p>}
      {!instructions && <p className="warn">No payment instructions yet (bank account, check payee). {isOwner ? "Add them with Payment instructions below; they go into every reminder." : "Ask the owner to add them."}</p>}
      <div className="grid">
        <label>Tone
          <select value={tone} onChange={(e) => setTone(e.target.value as Tone)}>
            {(Object.keys(TONE_LABEL) as Tone[]).map((t) => <option key={t} value={t}>{TONE_LABEL[t]}</option>)}
          </select>
          <span className="muted small">Suggested from: {PAYER_LABEL[payer]}; oldest {maxDays} days overdue.</span>
        </label>
        <label>To<input type="email" value={to} onChange={(e) => setTo(e.target.value)} placeholder="client's email" /></label>
      </div>
      <label>Subject<input value={subject} onChange={(e) => setSubject(e.target.value)} /></label>
      <label>Message<textarea rows={16} value={body} onChange={(e) => setBody(e.target.value)} /></label>
      <div className="row wrap">
        <button type="button" onClick={copy}>Copy</button>
        <a className="button-like" href={mailtoLink(to, subject, body)}>Open in email</a>
        <button type="button" className="ghost" onClick={logSent}>I sent it</button>
        {isOwner && <button type="button" className="link" onClick={() => setEditInstr(!editInstr)}>Payment instructions…</button>}
        {msg && <span className="ok-text" role="status">{msg}</span>}
      </div>
      {editInstr && (
        <div className="chase-instr">
          <label>Payment instructions (in every reminder)
            <textarea rows={4} maxLength={800} value={instrText} onChange={(e) => setInstrText(e.target.value)}
              placeholder="e.g. Please deposit to: [bank], account name VSA Customs Brokerage, account no. [number]. Checks payable to VSA Customs Brokerage." />
          </label>
          <button type="button" onClick={saveInstructions}>Save instructions</button>
        </div>
      )}
      <p className="muted small">Nothing is sent by the app. Send it from your own email or messaging app, then press I sent it so the office knows.</p>
    </section>
  );
}
