// Turnaround report: typical days from arrival to lodged, lodged to released, released to billed,
// per client, processor and shipping line, for shipments lodged in a chosen period.
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { fetchAll, supabase } from "../lib/supabase";
import { dayLabel, today } from "../lib/types";
import { lineKey } from "../lib/freetime";
import { STRETCHES, STRETCH_LABEL, byGroup, daysOf, median, type JobDays, type Stretch, type THistory, type TJob } from "../lib/turnaround";

type Row = TJob & { client_id: string; carrier: string | null; clients: { name: string } | null; processor: { full_name: string | null; email: string } | null };
type By = "client" | "processor" | "line";
const BY_LABEL: Record<By, string> = { client: "Client", processor: "Processor", line: "Shipping line" };
const minus = (d: string, n: number) => new Date(Date.parse(d) - n * 86400000).toISOString().slice(0, 10);
const fmt = (v: number | null) => (v == null ? "—" : `${Math.round(v * 10) / 10} d`);

export default function Turnaround() {
  const [from, setFrom] = useState(minus(today(), 90));
  const [to, setTo] = useState(today());
  const [by, setBy] = useState<By>("client");
  const [rows, setRows] = useState<{ job: Row; days: JobDays }[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setRows(null); setError("");
    (async () => {
      const jobs = await fetchAll<Row>((a, b) => supabase.from("jobs")
        .select("id, job_no, client_id, carrier, eta, entry_filed_date, released_at, billed_on, clients(name), processor:profiles!jobs_processor_id_fkey(full_name,email)")
        .gte("entry_filed_date", from).lte("entry_filed_date", to).order("entry_filed_date").range(a, b) as never);
      // Only moves made by a person count; the import of old shipments wrote its own history on one day.
      const history: THistory[] = [];
      const ids = jobs.map((j) => j.id);
      for (let i = 0; i < ids.length; i += 150) {
        const { data, error } = await supabase.from("job_status_history").select("job_id, to_status, changed_at")
          .in("job_id", ids.slice(i, i + 150)).in("to_status", ["released", "delivered", "billed"]).not("changed_by", "is", null);
        if (error) throw new Error(error.message);
        history.push(...((data as THistory[]) ?? []));
      }
      setRows(jobs.map((job) => ({ job, days: daysOf(job, history) })));
    })().catch((e: Error) => { setError(e.message); setRows([]); });
  }, [from, to]);

  const groupOf = (j: Row) => by === "client" ? j.clients?.name ?? "—" : by === "processor" ? (j.processor?.full_name || j.processor?.email || "Not assigned")
    : (lineKey(j.carrier) || "Not recorded");
  const groups = useMemo(() => byGroup((rows ?? []).map((r) => ({ group: groupOf(r.job), days: r.days }))), [rows, by]); // eslint-disable-line react-hooks/exhaustive-deps
  const overall = useMemo(() => Object.fromEntries(STRETCHES.map((k) => {
    const xs = (rows ?? []).map((r) => r.days[k]).filter((v): v is number => v !== undefined);
    return [k, { median: median(xs), n: xs.length }];
  })) as Record<Stretch, { median: number | null; n: number }>, [rows]);
  const slowest = useMemo(() => (rows ?? []).filter((r) => r.days.lodgedToReleased !== undefined)
    .sort((a, b) => b.days.lodgedToReleased! - a.days.lodgedToReleased!).slice(0, 10), [rows]);

  async function download() {
    setBusy(true);
    try {
      const { default: writeExcelFile } = await import("write-excel-file/browser");
      const n = (v: number | null | undefined) => (v == null ? null : { value: v, type: Number });
      const s = (v: string | null | undefined) => (v ? { value: v, type: String } : null);
      const bold = (h: string) => ({ value: h, fontWeight: "bold" as const });
      const sheet1 = [[BY_LABEL[by], "Shipments", ...STRETCHES.flatMap((k) => [`${STRETCH_LABEL[k]}: median days`, "counted"])].map(bold),
        ...groups.map((g) => [s(g.name), n(g.shipments), ...STRETCHES.flatMap((k) => [n(g[k].median), n(g[k].n)])])];
      const sheet2 = [["PN", "Client", "Processor", "Shipping line", "ETA", "Lodged", "Released", "Billed", ...STRETCHES.map((k) => STRETCH_LABEL[k])].map(bold),
        ...(rows ?? []).map(({ job: j, days }) => [s(j.job_no), s(j.clients?.name), s(j.processor?.full_name || j.processor?.email), s(j.carrier), s(j.eta), s(j.entry_filed_date),
          s(j.released_at?.slice(0, 10)), s(j.billed_on), ...STRETCHES.map((k) => n(days[k]))])];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (writeExcelFile as any)([{ data: sheet1, sheet: `By ${BY_LABEL[by].toLowerCase()}` }, { data: sheet2, sheet: "Shipments" }]).toFile(`VSA turnaround ${from} to ${to}.xlsx`);
    } catch (e) { setError(`Could not create the spreadsheet: ${(e as Error).message}`); }
    setBusy(false);
  }

  return (
    <>
      <p className="no-print"><Link to="/reports">← Reports</Link></p>
      <h1>Turnaround</h1>
      <section className="card">
        <div className="row wrap">
          <label className="row">Lodged from <input type="date" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} /></label>
          <label className="row">to <input type="date" value={to} min={from} onChange={(e) => e.target.value && setTo(e.target.value)} /></label>
          <label className="row">Group by
            <select value={by} onChange={(e) => setBy(e.target.value as By)}>{(Object.keys(BY_LABEL) as By[]).map((b) => <option key={b} value={b}>{BY_LABEL[b]}</option>)}</select>
          </label>
          <button type="button" onClick={download} disabled={busy || !rows?.length}>{busy ? "Preparing…" : "Download Excel"}</button>
        </div>
        {error && <p className="error">{error}</p>}
        {rows === null ? <p className="muted">Loading…</p> : (
          <>
            <div className="tiles">
              {STRETCHES.map((k) => (
                <div key={k} className={"tile" + (k === "lodgedToReleased" ? " main" : "")}>
                  <span>{STRETCH_LABEL[k]}</span><strong>{fmt(overall[k].median)}</strong>
                  <span className="muted small">typical, from {overall[k].n} of {rows.length} shipments</span>
                </div>
              ))}
            </div>
            <p className="muted small">
              Typical = the median: half the shipments took less, half took more. A stretch counts only when both of its dates are known: arrival is the ETA,
              lodged the entry filed date, released the release date or the move to Released / Delivered, billed the billed date or the move to Billed.
              {overall.arrivalToLodged.n < rows.length / 2 && " Few shipments have an ETA recorded, so Arrival → lodged covers only some of them."}
            </p>
          </>
        )}
      </section>

      {rows && rows.length > 0 && (
        <section className="card">
          <h2>By {BY_LABEL[by].toLowerCase()} <span className="count">{groups.length}</span></h2>
          <div className="table-scroll">
            <table className="small">
              <thead><tr><th>{BY_LABEL[by]}</th><th className="num">Shipments</th>{STRETCHES.map((k) => <th key={k} className="num">{STRETCH_LABEL[k]}</th>)}</tr></thead>
              <tbody>
                {groups.map((g) => (
                  <tr key={g.name}>
                    <td>{g.name}</td><td className="num">{g.shipments}</td>
                    {STRETCHES.map((k) => {
                      const slow = g[k].median != null && overall[k].median != null && g[k].n >= 3 && g[k].median! > overall[k].median! * 1.5;
                      return <td key={k} className={"num " + (slow ? "error" : "")} title={`${g[k].n} shipment(s) counted`}>{fmt(g[k].median)}{g[k].n ? <span className="muted"> ({g[k].n})</span> : ""}</td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted small">In brackets: how many shipments each figure is from. Red: half again slower than the office's typical, with at least 3 shipments.</p>
        </section>
      )}

      {slowest.length > 0 && (
        <section className="card">
          <h2>Slowest from lodged to released</h2>
          <table className="small">
            <thead><tr><th>PN</th><th>Client</th><th>Lodged</th><th>Released</th><th className="num">Days</th></tr></thead>
            <tbody>
              {slowest.map(({ job: j, days }) => (
                <tr key={j.id}><td><Link to={`/jobs/${j.id}`}>{j.job_no}</Link></td><td>{j.clients?.name}</td><td className="nowrap">{dayLabel(j.entry_filed_date)}</td>
                  <td className="nowrap">{dayLabel(j.released_at?.slice(0, 10) ?? null) ?? "from step move"}</td><td className="num">{days.lodgedToReleased}</td></tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </>
  );
}
