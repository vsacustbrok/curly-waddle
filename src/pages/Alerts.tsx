// Every open deadline across the active shipments: overdue first, then today, then the next few days.
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { fetchAll, supabase } from "../lib/supabase";
import { ALERT_KIND_LABEL, LEVEL_LABEL, SOON_DAYS, alertsFor, type Alert, type AlertKind, type AlertLevel } from "../lib/alerts";
import { STATUS_LABEL, dayLabel, type Job } from "../lib/types";

const FIELDS = "id, job_no, status, eta, cro_valid_until, storage_free_until, demurrage_free_until, tabs_at, tabs_ref, empty_return_date, empty_return_due, entry_no, bl_awb_no, containers, trucker_plate_no, clients(name), processor:profiles!jobs_processor_id_fkey(full_name,email)";
type Row = { job: Job; alert: Alert };
const LEVELS: AlertLevel[] = ["overdue", "today", "soon"];

/** Active shipments (not billed) with their open deadlines. Shared by this page and the menu badge. */
export async function loadAlerts(): Promise<Row[]> {
  const jobs = await fetchAll<Job>((a, b) => supabase.from("jobs").select(FIELDS).neq("status", "billed").order("job_no").range(a, b) as never);
  return jobs.flatMap((job) => alertsFor(job).map((alert) => ({ job, alert })))
    .sort((x, y) => x.alert.days - y.alert.days || x.job.job_no.localeCompare(y.job.job_no));
}

export default function Alerts() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState("");
  const [kind, setKind] = useState<AlertKind | "">("");
  const [busy, setBusy] = useState(false);

  useEffect(() => { loadAlerts().then(setRows, (e: Error) => { setError(e.message); setRows([]); }); }, []);
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
        ["Step", 18, (r) => t(STATUS_LABEL[r.job.status])], ["Entry no.", 14, (r) => t(r.job.entry_no)], ["BL / AWB", 20, (r) => t(r.job.bl_awb_no)],
        ["Containers", 26, (r) => t((r.job.containers ?? []).join(" "))], ["Processor", 18, (r) => t(r.job.processor?.full_name || r.job.processor?.email)],
      ];
      const data = [cols.map(([h]) => ({ value: h, fontWeight: "bold" as const })), ...shown.map((r) => cols.map(([, , g]) => g(r)))];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await writeExcelFile(data as any, { columns: cols.map(([, w]) => ({ width: w })), stickyRowsCount: 1, sheet: "Deadlines" })
        .toFile(`VSA deadlines ${new Date().toISOString().slice(0, 10)}.xlsx`);
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
                    <thead><tr><th>Due</th><th>Deadline</th><th>What</th><th>PN</th><th>Client</th><th>Step</th><th>Containers</th><th>Processor</th></tr></thead>
                    <tbody>
                      {list.map(({ job, alert }) => (
                        <tr key={job.id + alert.kind}>
                          <td className="nowrap">{dayLabel(alert.due)}</td>
                          <td className="nowrap">{ALERT_KIND_LABEL[alert.kind]}</td>
                          <td><span className={"alert-chip " + alert.level}>{alert.label}</span></td>
                          <td className="nowrap"><Link to={`/jobs/${job.id}`}>{job.job_no}</Link></td>
                          <td>{job.clients?.name}</td>
                          <td><span className={"badge status-" + job.status}>{STATUS_LABEL[job.status]}</span></td>
                          <td>{(job.containers ?? []).join(" ")}</td>
                          <td>{job.processor?.full_name || job.processor?.email}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            );
          })}
        </>
      )}
    </>
  );
}
