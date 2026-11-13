// Collections: every shipment with a balance still to collect, grouped by client, with aging.
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { fetchAll, supabase } from "../lib/supabase";
import { STATUS_LABEL, dayLabel, type Job } from "../lib/types";
import { AGE_LABEL, ageOf, dueDate, money, peso, totals, type AgeBucket, type Charge, type Payment, type Totals } from "../lib/billing";
import { today } from "./JobFields";

const BUCKETS: AgeBucket[] = ["current", "1-30", "31-60", "61-90", "90+"];
type Item = { job: Job; t: Totals; due: string | null; age: AgeBucket };

export default function Collections() {
  const [items, setItems] = useState<Item[] | null>(null);
  const [error, setError] = useState("");
  const [showPaid, setShowPaid] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const [charges, payments] = await Promise.all([
        fetchAll<Charge>((a, b) => supabase.from("charges").select("job_id, amount, vatable, advance").order("id").range(a, b) as never),
        fetchAll<Payment>((a, b) => supabase.from("payments").select("job_id, amount").order("id").range(a, b) as never),
      ]);
      const ids = [...new Set(charges.map((c) => c.job_id))];
      const jobs: Job[] = [];
      for (let i = 0; i < ids.length; i += 150) {
        const { data, error } = await supabase.from("jobs").select("id, job_no, soa_no, billed_on, status, client_id, bl_awb_no, clients(name, payment_terms_days)").in("id", ids.slice(i, i + 150));
        if (error) throw new Error(error.message);
        jobs.push(...((data as unknown as Job[]) ?? []));
      }
      const now = today();
      setItems(jobs.map((job) => {
        const t = totals(charges.filter((c) => c.job_id === job.id), payments.filter((p) => p.job_id === job.id));
        const due = dueDate(job.billed_on, job.clients?.payment_terms_days);
        return { job, t, due, age: t.balance > 0 ? ageOf(due, now) : "current" };
      }));
    })().catch((e: Error) => { setError(e.message); setItems([]); });
  }, []);

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
                      <td><button type="button" className="link" onClick={() => setOpen(open === c.id ? null : c.id)}>{open === c.id ? "▾" : "▸"} {c.name}</button></td>
                      <td className="num">{c.items.length}</td>
                      {BUCKETS.map((b) => {
                        const v = c.items.filter((i) => i.t.balance > 0 && i.age === b).reduce((s, i) => s + i.t.balance, 0);
                        return <td key={b} className={"num " + (v && b !== "current" ? "age-" + b : "")}>{v ? money(v) : ""}</td>;
                      })}
                      <td className="num"><strong>{money(c.balance)}</strong></td>
                    </tr>,
                    open === c.id && (
                      <tr key={c.id + "-items"}><td colSpan={BUCKETS.length + 3}>
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
