// Month calendar of shipments by ETA, with each shipment's arrival details, so the team can see what
// is arriving, when, on which vessel, with which containers, and where it goes.
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { fetchAll, supabase } from "../lib/supabase";
import { BL_RELEASE_LABEL, STATUS_LABEL, dayLabel, type Job } from "../lib/types";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const p2 = (x: number) => String(x).padStart(2, "0");
const ymd = (y: number, m: number, d: number) => `${y}-${p2(m + 1)}-${p2(d)}`;
const FIELDS = "id, job_no, status, eta, vessel, voyage, carrier, bl_awb_no, booking_no, containers, port_of_discharge, port_of_destination, item_description, supplier, entry_no, cro_no, cro_valid_until, bl_release_type, storage_free_until, demurrage_free_until, clients(name)";
const vesselOf = (j: Job) => [j.vessel, j.voyage].filter(Boolean).join(" / ");

export default function Calendar() {
  const now = new Date();
  const [month, setMonth] = useState({ y: now.getFullYear(), m: now.getMonth() });
  const [jobs, setJobs] = useState<Job[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [day, setDay] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const first = ymd(month.y, month.m, 1);
  const daysInMonth = new Date(month.y, month.m + 1, 0).getDate();
  const last = ymd(month.y, month.m, daysInMonth);
  const todayStr = ymd(now.getFullYear(), now.getMonth(), now.getDate());

  useEffect(() => {
    setLoading(true); setDay(null);
    fetchAll<Job>((a, b) => supabase.from("jobs").select(FIELDS).gte("eta", first).lte("eta", last).order("eta").order("job_no").range(a, b) as never)
      .then((rows) => { setError(""); setJobs(rows); setLoading(false); }, (e: Error) => { setError(e.message); setJobs([]); setLoading(false); });
  }, [first, last]);

  const byDay = useMemo(() => {
    const map = new Map<string, Job[]>();
    for (const j of jobs) if (j.eta) map.set(j.eta, [...(map.get(j.eta) ?? []), j]);
    return map;
  }, [jobs]);

  const lead = new Date(month.y, month.m, 1).getDay();
  const cells: (number | null)[] = [...Array(lead).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];
  while (cells.length % 7) cells.push(null);
  const shift = (n: number) => setMonth(({ y, m }) => { const d = new Date(y, m + n, 1); return { y: d.getFullYear(), m: d.getMonth() }; });
  const title = new Date(month.y, month.m, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const upcoming = jobs.filter((j) => j.eta! >= todayStr).length;
  const boxes = jobs.reduce((s, j) => s + (j.containers?.length ?? 0), 0);
  const listed = day ? byDay.get(day) ?? [] : jobs;

  async function download() {
    setBusy(true);
    try {
      const { default: writeExcelFile } = await import("write-excel-file/browser");
      const t = (v: string | null | undefined) => (v ? { value: v, type: String } : null);
      const d = (v: string | null | undefined) => (v ? { value: new Date(v + "T00:00:00Z"), type: Date, format: "yyyy-mm-dd" } : null);
      const cols: [string, number, (j: Job) => unknown][] = [
        ["ETA", 12, (j) => d(j.eta)], ["PN", 16, (j) => t(j.job_no)], ["Client", 28, (j) => t(j.clients?.name)], ["Step", 16, (j) => t(STATUS_LABEL[j.status])],
        ["Vessel / voyage", 26, (j) => t(vesselOf(j))], ["Carrier", 18, (j) => t(j.carrier)], ["BL / AWB", 20, (j) => t(j.bl_awb_no)],
        ["Booking no.", 16, (j) => t(j.booking_no)], ["Containers", 30, (j) => t((j.containers ?? []).join(" "))], ["No. of containers", 10, (j) => ({ value: j.containers?.length ?? 0, type: Number })],
        ["Port of discharge", 18, (j) => t(j.port_of_discharge)], ["Warehouse", 20, (j) => t(j.port_of_destination)], ["Item", 30, (j) => t(j.item_description)],
        ["Supplier", 24, (j) => t(j.supplier)], ["Entry no.", 14, (j) => t(j.entry_no)], ["BL release", 16, (j) => t(j.bl_release_type ? BL_RELEASE_LABEL[j.bl_release_type] : null)],
        ["CRO no.", 14, (j) => t(j.cro_no)], ["CRO valid until", 12, (j) => d(j.cro_valid_until)],
        ["Storage free until", 12, (j) => d(j.storage_free_until)], ["Demurrage free until", 12, (j) => d(j.demurrage_free_until)],
      ];
      const data = [cols.map(([h]) => ({ value: h, fontWeight: "bold" as const })), ...listed.map((j) => cols.map(([, , g]) => g(j)))];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await writeExcelFile(data as any, { columns: cols.map(([, w]) => ({ width: w })), stickyRowsCount: 1, sheet: "Arrivals" })
        .toFile(`VSA arrivals ${day ?? first.slice(0, 7)}.xlsx`);
    } catch (e) { setError(`Could not create the spreadsheet: ${(e as Error).message}`); }
    setBusy(false);
  }

  return (
    <>
      <div className="row spread">
        <h1>Arrival calendar</h1>
        <div className="row">
          <button className="ghost" onClick={() => shift(-1)} aria-label="Previous month">‹ Prev</button>
          <strong className="cal-title">{title}</strong>
          <button className="ghost" onClick={() => shift(1)} aria-label="Next month">Next ›</button>
          <button className="ghost" onClick={() => setMonth({ y: now.getFullYear(), m: now.getMonth() })}>This month</button>
        </div>
      </div>
      <p className="muted small">
        Shipments are placed on their ETA. {loading ? "Loading…" : `${jobs.length} shipment${jobs.length === 1 ? "" : "s"} and ${boxes} container${boxes === 1 ? "" : "s"} this month, ${upcoming} still to arrive.`} Click a day to list only its arrivals; click a shipment to open it.
      </p>
      {error && <p className="error">{error}</p>}
      <section className="card cal">
        {WEEKDAYS.map((w) => <div key={w} className="cal-head">{w}</div>)}
        {cells.map((d, i) => {
          if (d == null) return <div key={i} className="cal-cell empty" />;
          const key = ymd(month.y, month.m, d);
          const list = byDay.get(key) ?? [];
          return (
            <div key={i} className={"cal-cell" + (key === todayStr ? " today" : "") + (key < todayStr ? " past" : "") + (key === day ? " picked" : "")}
              onClick={() => list.length && setDay(day === key ? null : key)} role={list.length ? "button" : undefined}
              aria-label={list.length ? `${dayLabel(key)}: ${list.length} arrival${list.length === 1 ? "" : "s"}` : undefined}>
              <div className="cal-day">{d}{list.length > 0 && <span className="cal-count">{list.length}</span>}</div>
              {list.map((j) => (
                <Link key={j.id} to={`/jobs/${j.id}`} className={"cal-item status-" + j.status} onClick={(e) => e.stopPropagation()}
                  title={[j.job_no, j.clients?.name, vesselOf(j), j.carrier, j.bl_awb_no && `BL ${j.bl_awb_no}`, (j.containers ?? []).join(" "), j.port_of_discharge, j.port_of_destination && `Warehouse ${j.port_of_destination}`, j.item_description, STATUS_LABEL[j.status]].filter(Boolean).join("\n")}>
                  <strong>{j.job_no}</strong>
                  <span className="small">{j.clients?.name}</span>
                  {vesselOf(j) && <span className="small">Vessel {vesselOf(j)}</span>}
                  {!!j.containers?.length && <span className="small">{j.containers.length} cntr: {j.containers[0]}{j.containers.length > 1 ? " …" : ""}</span>}
                  {(j.port_of_discharge || j.port_of_destination) && <span className="small">{[j.port_of_discharge, j.port_of_destination].filter(Boolean).join(" → ")}</span>}
                </Link>
              ))}
            </div>
          );
        })}
      </section>

      <section className="card">
        <div className="row spread">
          <h2>{day ? `Arrivals on ${dayLabel(day)}` : `All arrivals in ${title}`} <span className="count">{listed.length}</span></h2>
          <div className="row">
            {day && <button type="button" className="ghost" onClick={() => setDay(null)}>Show the whole month</button>}
            <button type="button" onClick={download} disabled={busy || !listed.length}>{busy ? "Preparing…" : "Download Excel"}</button>
          </div>
        </div>
        {listed.length === 0 ? <p className="muted">{loading ? "Loading…" : "No shipments with an ETA in this month. Set the ETA in a shipment's project details."}</p> : (
          <div className="table-scroll">
            <table className="wide-table small">
              <thead>
                <tr><th>ETA</th><th>PN</th><th>Client</th><th>Step</th><th>Vessel / voyage</th><th>Carrier</th><th>BL / AWB</th><th>Containers</th>
                  <th>Port → warehouse</th><th>Item</th><th>BL release</th><th>CRO valid until</th><th>Free time ends</th></tr>
              </thead>
              <tbody>
                {listed.map((j) => (
                  <tr key={j.id} className={j.eta! < todayStr ? "muted-row" : ""}>
                    <td className="nowrap">{dayLabel(j.eta)}</td>
                    <td className="nowrap"><Link to={`/jobs/${j.id}`}>{j.job_no}</Link></td>
                    <td>{j.clients?.name}</td>
                    <td><span className={"badge status-" + j.status}>{STATUS_LABEL[j.status]}</span></td>
                    <td>{vesselOf(j)}</td>
                    <td>{j.carrier}</td>
                    <td>{j.bl_awb_no}</td>
                    <td>{(j.containers ?? []).join(" ")}</td>
                    <td>{[j.port_of_discharge, j.port_of_destination].filter(Boolean).join(" → ")}</td>
                    <td className="clip" title={j.item_description ?? ""}>{j.item_description}</td>
                    <td>{j.bl_release_type ? BL_RELEASE_LABEL[j.bl_release_type] : ""}</td>
                    <td className="nowrap">{dayLabel(j.cro_valid_until)}</td>
                    <td className="nowrap">{[j.storage_free_until && `Storage ${dayLabel(j.storage_free_until)}`, j.demurrage_free_until && `Demurrage ${dayLabel(j.demurrage_free_until)}`].filter(Boolean).join(", ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
