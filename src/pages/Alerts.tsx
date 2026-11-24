// Every open deadline across the active shipments: overdue first, then today, then the next few days.
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { ALERT_KIND_LABEL, LEVEL_LABEL, SOON_DAYS, loadAlerts, loadFreeRules, type AlertKind, type AlertLevel, type AlertRow } from "../lib/alerts";
import type { FreeKind, FreeRule } from "../lib/freetime";
import { peso } from "../lib/billing";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { today } from "../lib/types";
import { loadPermits } from "./PermitBanner";
import { WARN_DAYS, stateOf, warningText, type Permit } from "../lib/permits";
import { STATUS_LABEL, dayLabel } from "../lib/types";

type Row = AlertRow;
const LEVELS: AlertLevel[] = ["overdue", "today", "soon"];

export default function Alerts() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState("");
  const [kind, setKind] = useState<AlertKind | "">("");
  const [busy, setBusy] = useState(false);

  const reload = () => loadAlerts(true).then(setRows, (e: Error) => { setError(e.message); setRows([]); });
  useEffect(() => { reload(); }, []);
  // Pesos running across all shipments (each shipment counted once).
  const risk = useMemo(() => {
    const seen = new Map<string, NonNullable<AlertRow["money"]>>();
    for (const r of rows ?? []) if (r.money && (r.money.now || r.money.in3Days || r.money.missingRate)) seen.set(r.job.id, r.money);
    const list = [...seen.values()];
    return { now: list.reduce((a, m) => a + m.now, 0), in3Days: list.reduce((a, m) => a + m.in3Days, 0), shipments: list.filter((m) => m.now > 0).length, missingRate: list.some((m) => m.missingRate) };
  }, [rows]);
  const amountOf = (r: AlertRow) => r.lines?.find((l) => l.kind === r.alert.kind);
  const shown = useMemo(() => (rows ?? []).filter((r) => !kind || r.alert.kind === kind), [rows, kind]);
  const count = (l: AlertLevel) => shown.filter((r) => r.alert.level === l).length;

  async function download() {
    setBusy(true);
    try {
      const { default: writeExcelFile } = await import("write-excel-file/browser");
      const t = (v: string | null | undefined) => (v ? { value: v, type: String } : null);
      const cols: [string, number, (r: Row) => unknown][] = [
        ["Urgency", 12, (r) => t(LEVEL_LABEL[r.alert.level])], ["Deadline", 20, (r) => t(ALERT_KIND_LABEL[r.alert.kind])],
        ["Due", 12, (r) => ({ value: new Date(r.alert.due + "T00:00:00Z"), type: Date, format: "yyyy-mm-dd" })],
        ["What", 34, (r) => t(r.alert.label)], ["PN", 16, (r) => t(r.job.job_no)], ["Client", 28, (r) => t(r.job.clients?.name)],
        ["Step", 18, (r) => t(STATUS_LABEL[r.job.status])],
        ["₱ running now", 14, (r) => { const l = amountOf(r); return l?.amount ? { value: l.amount, type: Number, format: "#,##0.00" } : null; }], ["Entry no.", 14, (r) => t(r.job.entry_no)], ["BL / AWB", 20, (r) => t(r.job.bl_awb_no)],
        ["Containers", 26, (r) => t((r.job.containers ?? []).join(" "))], ["Processor", 18, (r) => t(r.job.processor?.full_name || r.job.processor?.email)],
      ];
      const data = [cols.map(([h]) => ({ value: h, fontWeight: "bold" as const })), ...shown.map((r) => cols.map(([, , g]) => g(r)))];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await writeExcelFile(data as any, { columns: cols.map(([, w]) => ({ width: w })), stickyRowsCount: 1, sheet: "Deadlines" })
        .toFile(`VSA deadlines ${today()}.xlsx`);
    } catch (e) { setError(`Could not create the spreadsheet: ${(e as Error).message}`); }
    setBusy(false);
  }

  return (
    <>
      <div className="row spread">
        <h1>Deadlines and alerts</h1>
        <div className="row">
          <select value={kind} onChange={(e) => setKind(e.target.value as AlertKind | "")} aria-label="Which deadlines">
            <option value="">All deadlines</option>
            {(Object.keys(ALERT_KIND_LABEL) as AlertKind[]).map((k) => <option key={k} value={k}>{ALERT_KIND_LABEL[k]}</option>)}
          </select>
          <button type="button" onClick={download} disabled={busy || !shown.length}>{busy ? "Preparing…" : "Download Excel"}</button>
        </div>
      </div>
      <p className="muted small">
        Worked out from each shipment's dates: ETA, CRO valid until, storage and demurrage free time, TABS appointment and empty return due.
        Shows what is overdue, due today or due in the next {SOON_DAYS} days. Add the dates in each shipment's project details.
      </p>
      {error && <p className="error">{error}</p>}
      {rows === null ? <p className="muted">Loading…</p> : (
        <>
          {(risk.now > 0 || risk.in3Days > 0 || risk.missingRate) && (
            <section className="card risk-card">
              <div className="tiles">
                <div className="tile main"><span>Storage and demurrage running now</span><strong>{peso(risk.now)}</strong></div>
                <div className="tile"><span>If nothing moves in 3 days</span><strong>{peso(risk.in3Days)}</strong></div>
                <div className="tile"><span>Shipments past free time</span><strong>{risk.shipments}</strong></div>
              </div>
              <p className="muted small">Estimated: days past the last free day × containers × the daily rate below. Dates marked (est.) come from the ETA; type the real last free day on the shipment to replace them.
                {risk.missingRate && " Some daily rates are not set yet, so the amounts are incomplete."}</p>
            </section>
          )}
          <div className="row stat-row">
            {LEVELS.map((l) => <span key={l} className={"alert-chip big " + l}><strong>{count(l)}</strong> {LEVEL_LABEL[l].toLowerCase()}</span>)}
          </div>
          {shown.length === 0 ? <section className="card"><p className="ok">Nothing overdue or due in the next {SOON_DAYS} days.</p></section> : LEVELS.map((l) => {
            const list = shown.filter((r) => r.alert.level === l);
            if (!list.length) return null;
            return (
              <section key={l} className={"card alert-group " + l}>
                <h2>{LEVEL_LABEL[l]} <span className="count">{list.length}</span></h2>
                <div className="table-scroll">
                  <table className="wide-table small">
                    <thead><tr><th>Due</th><th>Deadline</th><th>What</th><th>PN</th><th>Client</th><th>Step</th><th className="num">₱ running</th><th>Containers</th><th>Processor</th></tr></thead>
                    <tbody>
                      {list.map((row) => { const { job, alert } = row; const line = amountOf(row); return (
                        <tr key={job.id + alert.kind}>
                          <td className="nowrap">{dayLabel(alert.due)}</td>
                          <td className="nowrap">{ALERT_KIND_LABEL[alert.kind]}</td>
                          <td><span className={"alert-chip " + alert.level}>{alert.label}</span></td>
                          <td className="nowrap"><Link to={`/jobs/${job.id}`}>{job.job_no}</Link></td>
                          <td>{job.clients?.name}</td>
                          <td><span className={"badge status-" + job.status}>{STATUS_LABEL[job.status]}</span></td>
                          <td className="num nowrap">{line ? (line.amount ? peso(line.amount) : line.perDay == null ? <span className="muted" title="Daily rate not set">rate?</span> : "") : ""}</td>
                          <td>{(job.containers ?? []).join(" ")}</td>
                          <td>{job.processor?.full_name || job.processor?.email}</td>
                        </tr>
                      ); })}
                    </tbody>
                  </table>
                </div>
              </section>
            );
          })}
        </>
      )}
      <PermitAlerts />
      <FreeRules onSaved={reload} />
    </>
  );
}

/** Free days and daily rates per shipping line (demurrage) and for the port (storage). Owner edits; staff read. */
function FreeRules({ onSaved }: { onSaved: () => void }) {
  const { profile } = useAuth();
  const isOwner = profile?.role === "owner";
  const [rules, setRules] = useState<FreeRule[]>([]);
  const [error, setError] = useState("");
  const [form, setForm] = useState({ kind: "demurrage" as FreeKind, name: "", free_days: "", rate_20: "", rate_40: "" });
  const load = () => loadFreeRules(true).then(setRules, (e: Error) => setError(e.message));
  useEffect(() => { load(); }, []);
  const num = (v: string) => (v.trim() === "" ? null : Number(v.replace(/,/g, "")));

  async function change(r: FreeRule, patch: Partial<FreeRule>) {
    setError("");
    const { error } = await supabase.from("free_time_rules").update(patch).eq("id", r.id!);
    if (error) setError(error.message.includes("check") ? "Free days must be 0 to 60, and rates zero or more." : error.message);
    await load(); onSaved();
  }
  async function add(e: FormEvent) {
    e.preventDefault(); setError("");
    const row = { kind: form.kind, name: form.name.trim(), free_days: num(form.free_days), rate_20: num(form.rate_20), rate_40: num(form.rate_40) };
    if (!row.name || row.free_days == null || !Number.isInteger(row.free_days)) { setError("Enter the shipping line (or port) and its free days as a whole number."); return; }
    if ([row.rate_20, row.rate_40].some((v) => v != null && !(v >= 0))) { setError("Enter the rates as numbers, or leave them blank."); return; }
    const { error } = await supabase.from("free_time_rules").insert(row);
    if (error) { setError(error.message.includes("duplicate") ? `${row.name} already has a ${row.kind} row.` : error.message); return; }
    setForm({ ...form, name: "", free_days: "", rate_20: "", rate_40: "" }); await load(); onSaved();
  }
  async function remove(r: FreeRule) {
    if (!confirm(`Remove the ${r.kind} row for ${r.name}? Its shipments will use the Default row.`)) return;
    const { error } = await supabase.from("free_time_rules").delete().eq("id", r.id!);
    if (error) setError(error.message);
    await load(); onSaved();
  }
  const cell = (r: FreeRule, k: "free_days" | "rate_20" | "rate_40", label: string) => (
    <input key={`${r.id}-${k}-${r[k]}`} defaultValue={r[k] == null ? "" : String(Number(r[k]))} inputMode="decimal" disabled={!isOwner} aria-label={`${r.name} ${r.kind} ${label}`}
      style={{ width: "7em" }} placeholder={k === "free_days" ? "" : "not set"}
      onBlur={(e) => { const v = num(e.target.value); if (v !== (r[k] == null ? null : Number(r[k]))) change(r, { [k]: v } as Partial<FreeRule>); }} />
  );

  return (
    <section className="card" id="free-time">
      <h2>Free days and daily rates</h2>
      <p className="muted small">
        Demurrage: free days and charge per container per day for each shipping line; lines without their own row use Default.
        Storage: the port's free days and daily charge. The ETA counts as day 1. Amounts in pesos per container per day; check them against the latest tariff from the line or port.
        {!isOwner && " Only the owner can change them."}
      </p>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="table-scroll">
        <table className="small">
          <thead><tr><th>Kind</th><th>Shipping line / port</th><th className="num">Free days</th><th className="num">₱ / day, 20-ft</th><th className="num">₱ / day, 40-ft</th><th></th></tr></thead>
          <tbody>
            {rules.map((r) => (
              <tr key={r.id}>
                <td>{r.kind === "demurrage" ? "Demurrage" : "Storage"}</td>
                <td>{r.name}{r.note && <div className="muted small">{r.note}</div>}</td>
                <td className="num">{cell(r, "free_days", "free days")}</td>
                <td className="num">{cell(r, "rate_20", "rate 20-ft")}</td>
                <td className="num">{cell(r, "rate_40", "rate 40-ft")}</td>
                <td>{isOwner && r.name !== "Default" && <button type="button" className="link danger-text" onClick={() => remove(r)}>Remove</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {isOwner && (
        <form className="row wrap" onSubmit={add} style={{ marginTop: 10 }}>
          <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as FreeKind })} aria-label="Kind">
            <option value="demurrage">Demurrage</option><option value="storage">Storage</option>
          </select>
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Maersk" aria-label="Shipping line or port" list="free-lines" />
          <datalist id="free-lines">{["Maersk", "MSC", "CMA CGM", "COSCO", "Evergreen", "Hapag-Lloyd", "ONE", "OOCL", "Yang Ming", "TS Lines", "Hyundai", "Sinotrans", "Wan Hai", "SITC"].map((n) => <option key={n} value={n} />)}</datalist>
          <input value={form.free_days} onChange={(e) => setForm({ ...form, free_days: e.target.value })} placeholder="Free days" inputMode="numeric" aria-label="Free days" style={{ width: "7em" }} />
          <input value={form.rate_20} onChange={(e) => setForm({ ...form, rate_20: e.target.value })} placeholder="₱/day 20-ft" inputMode="decimal" aria-label="Rate per day 20-ft" style={{ width: "8em" }} />
          <input value={form.rate_40} onChange={(e) => setForm({ ...form, rate_40: e.target.value })} placeholder="₱/day 40-ft" inputMode="decimal" aria-label="Rate per day 40-ft" style={{ width: "8em" }} />
          <button>Add</button>
        </form>
      )}
    </section>
  );
}

/** Permits and accreditations lapsed or lapsing within WARN_DAYS days. */
function PermitAlerts() {
  const [list, setList] = useState<Permit[]>([]);
  useEffect(() => { loadPermits(true).then((all) => setList(all.filter((p) => ["expired", "soon"].includes(stateOf(p, today())))), () => {}); }, []);
  if (!list.length) return null;
  const now = today();
  return (
    <section className="card alert-group soon">
      <h2>Permits and accreditations <span className="count">{list.length}</span></h2>
      <p className="muted small">Expired, or expiring within {WARN_DAYS} days.</p>
      <ul className="small">
        {list.map((p) => (
          <li key={p.id}><span className={"alert-chip " + (stateOf(p, now) === "expired" ? "overdue" : "soon")}>{warningText(p, now)}</span>{" "}
            {p.clients?.name ?? "VSA (office)"}{p.reference_no ? ` · no. ${p.reference_no}` : ""}</li>
        ))}
      </ul>
      <Link to="/permits">Open permits</Link>
    </section>
  );
}
