import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { fetchAll, supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { alertsFor } from "../lib/alerts";
import { matchesSearch, searchAllYears, searchText, type FoundJob } from "../lib/search";
import { STATUSES, STATUS_LABEL, dateTime, dayLabel, pretty, type Job, type Role, type JobStatus } from "../lib/types";

// The stages each role acts on, highlighted on their board.
const FOCUS: Record<Role, JobStatus[]> = {
  owner: [], pending: [],
  processor: ["pre_arrival", "lodged", "assessed", "paid", "gatepass"],
  dispatcher: ["tabs", "delivered"],
  billing: ["assessed", "delivered"],
};

type Scan = { error_count: number; warning_count: number; run_at: string };
type BoardJob = Job & { scan_results?: Scan[] };

/** The result of the latest document check, as a small badge. */
function CheckBadge({ scans }: { scans?: Scan[] }) {
  const latest = [...(scans ?? [])].sort((a, b) => b.run_at.localeCompare(a.run_at))[0];
  if (!latest) return <span className="check-badge none">Not checked</span>;
  if (latest.error_count) return <span className="check-badge bad">{latest.error_count} to fix</span>;
  if (latest.warning_count) return <span className="check-badge review">{latest.warning_count} to review</span>;
  return <span className="check-badge good">Documents OK</span>;
}

/** One column of the shipment list and of the Excel file: heading, Excel width, value. */
type Col = [string, number, (j: BoardJob) => string | null | undefined];
const COLS: Col[] = [
  ["PN", 16, (j) => j.job_no], ["Client", 26, (j) => j.clients?.name], ["Client ref. no.", 14, (j) => j.client_ref_no],
  ["Item", 30, (j) => j.item_description], ["Supplier", 24, (j) => j.supplier], ["BL / AWB", 20, (j) => j.bl_awb_no],
  ["Containers", 26, (j) => (j.containers ?? []).join(" ")], ["Vessel", 18, (j) => j.vessel], ["ETA", 12, (j) => j.eta],
  ["Entry no.", 14, (j) => j.entry_no], ["Entry filed on", 12, (j) => j.entry_filed_date], ["Color", 9, (j) => (j.entry_color ? pretty(j.entry_color) : null)],
  ["Lodge code", 10, (j) => j.lodge_status], ["Ticket no.", 16, (j) => j.ticket_no], ["CRO no.", 14, (j) => j.cro_no],
  ["Gatepass ref. no.", 16, (j) => j.gatepass_ref], ["Gatepass date", 12, (j) => j.gatepass_date],
  ["TABS ref. no.", 16, (j) => j.tabs_ref], ["TABS date and time", 18, (j) => dateTime(j.tabs_at)],
  ["Yard", 22, (j) => j.yard], ["Trucker", 16, (j) => j.trucker_name], ["Plate no.", 11, (j) => j.trucker_plate_no],
  ["Delivery address", 30, (j) => j.delivery_address], ["Warehouse", 18, (j) => j.port_of_destination],
  ["Processor", 18, (j) => j.processor?.full_name || j.processor?.email], ["Remarks", 30, (j) => j.lodge_remarks], ["Note", 30, (j) => j.lodge_note],
];
const fileLabel = (s: JobStatus) => STATUS_LABEL[s].replace(/\s*\/\s*/g, " and ");

/** The shipments of one column as an Excel file, ready to hand to a processor. */
/**
 * Gatepass summary, laid out like the office's gatepass sheet: one row per container.
 * Dates as MM/DD/YYYY and times as MM/DD/YYYY HH:MM:SS, the way the sheet writes them.
 */
const p2 = (n: number) => String(n).padStart(2, "0");
const sheetDay = (d: string | null | undefined) => (d ? `${d.slice(5, 7)}/${d.slice(8, 10)}/${d.slice(0, 4)}` : "");
const sheetTime = (iso: string | null | undefined) => {
  if (!iso) return "";
  const t = new Date(iso);
  return `${p2(t.getMonth() + 1)}/${p2(t.getDate())}/${t.getFullYear()} ${p2(t.getHours())}:${p2(t.getMinutes())}:${p2(t.getSeconds())}`;
};
type GateRow = { job: BoardJob; container: string };
const GATEPASS_COLS: [string, number, (r: GateRow) => string][] = [
  ["CONTAINER", 16, (r) => r.container],
  ["DELIVERY", 30, (r) => [r.job.delivery_address, r.job.entry_color?.toUpperCase()].filter(Boolean).join(" - ")],
  ["SHIPPING LINE", 16, (r) => (r.job.carrier ?? "").toUpperCase()],
  ["CONTAINER SIZE", 14, (r) => r.job.container_size ?? ""],
  ["CONSIGNEE", 26, (r) => r.job.clients?.name ?? ""],
  ["DEMURRAGE", 13, (r) => sheetDay(r.job.demurrage_free_until)],
  ["STORAGE", 13, (r) => sheetDay(r.job.storage_free_until)],
  ["ELECTRIC", 20, (r) => (r.job.reefer === false ? "DRY" : sheetTime(r.job.electric_until))],
  ["TRUCKER", 16, (r) => r.job.trucker_name ?? ""],
  ["PLATE NO.", 12, (r) => r.job.trucker_plate_no ?? ""],
  ["TABS BOOKING", 22, (r) => [r.job.tabs_ref, sheetTime(r.job.tabs_at)].filter(Boolean).join(" ")],
  ["RELEASE DATE/TIME", 20, (r) => sheetTime(r.job.released_at)],
];
const gateRows = (list: BoardJob[]): GateRow[] =>
  list.flatMap((job) => (job.containers?.length ? job.containers : [""]).map((container) => ({ job, container })));

async function downloadColumn(s: JobStatus, list: BoardJob[]) {
  const { default: writeExcelFile } = await import("write-excel-file/browser");
  const stamp = new Date().toISOString().slice(0, 10);
  if (s === "gatepass") {
    const head = { fontWeight: "bold" as const, color: "#FFFFFF", backgroundColor: "#2E5E4E", align: "center" as const, alignVertical: "center" as const, height: 24 };
    const data = [
      GATEPASS_COLS.map(([h]) => ({ value: h, ...head })),
      ...gateRows(list).map((r) => GATEPASS_COLS.map(([, , get]) => {
        const v = get(r);
        return { value: v, type: String, align: "center" as const, fontWeight: "bold" as const, borderColor: "#BFBFBF", borderStyle: "thin" as const };
      })),
    ];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await writeExcelFile(data as any, { columns: GATEPASS_COLS.map(([, width]) => ({ width })), stickyRowsCount: 1, sheet: "Gatepass" })
      .toFile(`VSA Gatepass ${stamp}.xlsx`);
    return;
  }
  const data = [
    COLS.map(([h]) => ({ value: h, fontWeight: "bold" as const })),
    ...list.map((j) => COLS.map(([, , get]) => { const v = get(j); return v ? { value: v, type: String } : null; })),
  ];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await writeExcelFile(data as any, { columns: COLS.map(([, width]) => ({ width })), stickyRowsCount: 1, sheet: fileLabel(s).slice(0, 30) })
    .toFile(`VSA ${fileLabel(s)} shipments ${stamp}.xlsx`);
}

const BOARD_KEY = "vsa-board";
/** Only the fields the board shows, searches, alerts on and puts in its Excel files. */
const BOARD_FIELDS = [
  "id", "job_no", "status", "service_type", "client_id", "processor_id", "client_ref_no", "item_description", "supplier",
  "bl_awb_no", "containers", "vessel", "carrier", "eta", "entry_no", "entry_filed_date", "entry_color", "entry_status", "lodge_status",
  "ticket_no", "cro_no", "cro_valid_until", "storage_free_until", "demurrage_free_until", "gatepass_ref", "gatepass_date",
  "tabs_ref", "tabs_at", "yard", "trucker_name", "trucker_plate_no", "delivery_address", "port_of_destination",
  "empty_return_due", "empty_return_date", "lodge_remarks", "lodge_note",
  "container_size", "reefer", "electric_until", "released_at",
].join(", ") + ", clients(name), processor:profiles!jobs_processor_id_fkey(full_name,email), scan_results(error_count, warning_count, run_at)";

export default function Board() {
  const { profile } = useAuth();
  const role = profile!.role;
  const [jobs, setJobs] = useState<BoardJob[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [mine, setMine] = useState(false);
  const [open, setOpen] = useState<JobStatus | null>(null);
  const [downloading, setDownloading] = useState<JobStatus | null>(null);

  useEffect(() => {
    // The board is for this year's work: shipments lodged this year, or not lodged yet.
    // Earlier years stay under Shipments and Reports.
    // A refresh first shows the board as it was last loaded in this tab, then swaps in fresh data.
    const since = `${new Date().getFullYear()}-01-01`;
    try {
      const saved = JSON.parse(sessionStorage.getItem(BOARD_KEY) ?? "null") as { since: string; jobs: BoardJob[] } | null;
      if (saved?.since === since) { setJobs(saved.jobs); setLoading(false); }
    } catch { /* no saved copy */ }
    fetchAll<BoardJob>((a, b) => supabase.from("jobs").select(BOARD_FIELDS)
      .or(`entry_filed_date.is.null,entry_filed_date.gte.${since}`)
      .order("eta", { ascending: true, nullsFirst: false }).order("id").range(a, b) as never)
      .then((rows) => {
        setError(""); setJobs(rows); setLoading(false);
        try { sessionStorage.setItem(BOARD_KEY, JSON.stringify({ since, jobs: rows })); } catch { /* too big or blocked; fine */ }
      }, (e: Error) => { setError(e.message); setLoading(false); });
  }, []);

  // Search covers everything typed into a shipment; the database is also searched (all years,
  // daily status notes included) so nothing typed in is out of reach.
  const texts = useMemo(() => new Map(jobs.map((j) => [j.id, searchText(j)])), [jobs]);
  const [found, setFound] = useState<FoundJob[] | null>(null);
  const [searching, setSearching] = useState(false);
  useEffect(() => {
    const query = q.trim();
    if (query.length < 2) { setFound(null); return; }
    setSearching(true);
    let stale = false;
    const t = setTimeout(() => {
      searchAllYears(query).then((rows) => { if (!stale) { setFound(rows); setSearching(false); } },
        () => { if (!stale) { setFound([]); setSearching(false); } });
    }, 400);
    return () => { stale = true; clearTimeout(t); };
  }, [q]);
  const foundIds = useMemo(() => new Set((found ?? []).map((f) => f.id)), [found]);
  const filtered = useMemo(() => {
    const needle = q.trim();
    return jobs.filter((j) => {
      if (mine && j.processor_id !== profile!.id) return false;
      if (!needle) return true;
      return matchesSearch(texts.get(j.id) ?? "", needle) || foundIds.has(j.id);
    });
  }, [jobs, q, mine, profile, texts, foundIds]);
  const onBoard = useMemo(() => new Set(jobs.map((j) => j.id)), [jobs]);
  const elsewhere = (found ?? []).filter((f) => !onBoard.has(f.id));

  const columns = STATUSES; // every step, Pre-arrival through Billed
  const inColumn = (s: JobStatus) => filtered.filter((j) => (j.status === "released" ? "delivered" : j.status) === s); // Released shows as Released / Delivered
  async function download(s: JobStatus) {
    setDownloading(s); setError("");
    try { await downloadColumn(s, inColumn(s)); } catch (e) { setError(`Could not create the spreadsheet: ${(e as Error).message}`); }
    setDownloading(null);
  }
  const openList = open ? inColumn(open) : [];
  const today = new Date().toISOString().slice(0, 10);

  return (
    <>
      <div className="row spread">
        <h1>Status board</h1>
        <div className="row">
          <input placeholder="Search anything: PN, client, BL, container, entry, plate, note…" aria-label="Search shipments" value={q} onChange={(e) => setQ(e.target.value)} />
          {role === "processor" && (
            <label className="check"><input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> My shipments</label>
          )}
        </div>
      </div>
      {q.trim().length >= 2 && (
        <section className="card search-results" aria-live="polite">
          <strong>Search “{q.trim()}”:</strong> {filtered.length} on the board below
          {searching ? " · searching all years and daily notes…" : found && (elsewhere.length
            ? <> · {elsewhere.length}{elsewhere.length >= 200 ? "+" : ""} more in earlier years or other lists:</>
            : " · nothing more in earlier years or daily notes.")}
          {!searching && elsewhere.length > 0 && (
            <div className="table-scroll short">
              <table className="small">
                <thead><tr><th>PN</th><th>Client</th><th>Status</th><th>Lodged</th></tr></thead>
                <tbody>
                  {elsewhere.map((f) => (
                    <tr key={f.id}>
                      <td className="nowrap"><Link to={`/jobs/${f.id}`}>{f.job_no}</Link></td>
                      <td>{f.clients?.name}</td>
                      <td><span className={"badge status-" + f.status}>{STATUS_LABEL[f.status as JobStatus] ?? f.status}</span></td>
                      <td className="nowrap">{dayLabel(f.entry_filed_date)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
      <p className="muted small">{new Date().getFullYear()} shipments and any not lodged yet. Earlier years are under <Link to="/shipments">Shipments</Link>.</p>
      {error && <p className="error">{error}</p>}
      {loading ? <p className="muted">Loading…</p> : jobs.length === 0 ? (
        <p className="muted">No shipments yet.{(role === "owner" || role === "processor") && <> <Link to="/jobs/new">Create the first shipment</Link>.</>}</p>
      ) : (
        <div className="board">
          {columns.map((s) => {
            const list = inColumn(s);
            return (
              <section key={s} className={"column col-" + s + (FOCUS[role].includes(s) ? " focus" : "")}>
                <div className="col-head">
                  <h2><button type="button" className="col-title" onClick={() => setOpen(s)} title={`See all ${STATUS_LABEL[s]} shipments as a list`}>
                    {STATUS_LABEL[s]} <span className="count">{list.length}</span>
                  </button></h2>
                  <button type="button" className="col-dl" disabled={!list.length || downloading === s} onClick={() => download(s)}
                    aria-label={`Download ${STATUS_LABEL[s]} shipments as Excel`} title="Download as Excel">{downloading === s ? "…" : "⬇"}</button>
                </div>
                {list.map((j) => (
                  <Link key={j.id} to={`/jobs/${j.id}`} className="jobcard">
                    <strong>{j.job_no}{j.entry_color && <span className={"entry-color " + j.entry_color}>{pretty(j.entry_color)}</span>}</strong>
                    <span>{j.clients?.name}</span>
                    <span className="muted small">{pretty(j.service_type)}{j.bl_awb_no ? ` · ${j.bl_awb_no}` : ""}</span>
                    {j.eta && (
                      <span className={"small " + (j.eta < today && STATUSES.indexOf(s) < STATUSES.indexOf("delivered") ? "error" : "muted")}>ETA {j.eta}</span>
                    )}
                    {s === "gatepass" && j.gatepass_ref && <span className="small kw-gatepass">Gatepass {j.gatepass_ref}</span>}
                    {s === "tabs" && (j.tabs_ref || j.tabs_at) && (
                      <span className="small kw-tabs">TABS {j.tabs_ref}{j.tabs_at && ` · ${dateTime(j.tabs_at)}`}</span>
                    )}
                    {alertsFor(j).map((a) => <span key={a.kind} className={"alert-chip " + a.level}>{a.label}</span>)}
                    <CheckBadge scans={j.scan_results} />
                  </Link>
                ))}
              </section>
            );
          })}
        </div>
      )}
      {open && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={`${STATUS_LABEL[open]} shipments`} onClick={() => setOpen(null)}>
          <div className="card modal wide-modal" onClick={(e) => e.stopPropagation()}>
            <div className="row spread">
              <h2 className={"col-" + open + "-title"}>{STATUS_LABEL[open]}: {openList.length} shipment{openList.length === 1 ? "" : "s"}</h2>
              <div className="row">
                <button type="button" disabled={!openList.length || downloading === open} onClick={() => download(open)}>
                  {downloading === open ? "Preparing…" : "Download Excel"}</button>
                <button type="button" className="ghost" onClick={() => setOpen(null)}>Close</button>
              </div>
            </div>
            {q || mine ? <p className="muted small">Only shipments matching the search{mine ? " and “My shipments”" : ""} are listed.</p> : null}
            {openList.length === 0 ? <p className="muted">No shipments here.</p> : open === "gatepass" ? (
              <div className="table-scroll">
                <table className="wide-table small gatepass-table">
                  <thead><tr>{GATEPASS_COLS.map(([h]) => <th key={h}>{h}</th>)}</tr></thead>
                  <tbody>
                    {gateRows(openList).map((r) => (
                      <tr key={r.job.id + r.container}>
                        {GATEPASS_COLS.map(([h, , get], i) => (
                          <td key={h} className="nowrap">{i === 0 ? <Link to={`/jobs/${r.job.id}`}>{get(r) || r.job.job_no}</Link> : get(r)}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="table-scroll">
                <table className="wide-table small">
                  <thead><tr><th>PN</th><th>Client</th><th>Item</th><th>BL / AWB</th><th>Containers</th><th>Entry no.</th><th>Filed</th><th>Color</th>
                    <th>Gatepass</th><th>TABS</th><th>Processor</th><th>Remarks</th></tr></thead>
                  <tbody>
                    {openList.map((j) => (
                      <tr key={j.id}>
                        <td className="nowrap"><Link to={`/jobs/${j.id}`}>{j.job_no}</Link></td>
                        <td>{j.clients?.name}</td>
                        <td className="clip" title={j.item_description ?? ""}>{j.item_description}</td>
                        <td>{j.bl_awb_no}</td>
                        <td>{(j.containers ?? []).join(" ")}</td>
                        <td className="nowrap">{j.entry_no}</td>
                        <td className="nowrap">{dayLabel(j.entry_filed_date)}</td>
                        <td>{j.entry_color && <span className={"entry-color " + j.entry_color}>{pretty(j.entry_color)}</span>}</td>
                        <td className="kw-gatepass">{[j.gatepass_ref, dayLabel(j.gatepass_date)].filter(Boolean).join(", ")}</td>
                        <td className="kw-tabs">{[j.tabs_ref, dateTime(j.tabs_at)].filter(Boolean).join(", ")}</td>
                        <td>{j.processor?.full_name || j.processor?.email}</td>
                        <td className="clip" title={j.lodge_remarks ?? ""}>{j.lodge_remarks}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
