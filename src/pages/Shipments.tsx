import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { STATUS_LABEL, pretty, type Job } from "../lib/types";
import { summarize, type DocLike, type Shipment } from "../lib/shipment";

type Row = Job & {
  job_documents: DocLike[];
  scan_results: { error_count: number; warning_count: number; run_at: string }[];
};
type Line = {
  job: Row; s: Shipment; bl: string | null; containers: string[]; vessel: string | null; voyage: string | null;
  pod: string | null; scan: { error_count: number; warning_count: number } | null;
};

function toLine(job: Row): Line {
  const s = summarize(job.job_documents ?? []);
  const scans = [...(job.scan_results ?? [])].sort((a, b) => b.run_at.localeCompare(a.run_at));
  return {
    job, s,
    // What is on the job record wins: it starts as what was read and may have been corrected by hand.
    bl: job.bl_awb_no ?? s.blNo,
    containers: job.containers?.length ? job.containers : s.containers,
    vessel: job.vessel ?? s.vessel,
    voyage: job.voyage ?? s.voyage,
    pod: job.port_of_discharge ?? s.portOfDischarge,
    scan: scans[0] ?? null,
  };
}

const n = (v: number | null) => (v == null ? "" : v.toLocaleString());
/** The calendar day of a timestamp in the viewer's own time zone, as YYYY-MM-DD. */
function localDay(iso: string): string {
  const d = new Date(iso);
  const p = (x: number) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

async function exportXlsx(lines: Line[]) {
  const { default: writeExcelFile } = await import("write-excel-file/browser");
  const head = (value: string) => ({ value, fontWeight: "bold" as const });
  const text = (v: string | null | undefined) => (v ? { value: v, type: String } : null);
  const number = (v: number | null, format?: string) => (v == null ? null : { value: v, type: Number, ...(format ? { format } : {}) });
  const date = (iso: string | null) => (iso ? { value: new Date(iso.slice(0, 10) + "T00:00:00Z"), type: Date, format: "yyyy-mm-dd" } : null);
  const columns: [string, number, (l: Line) => unknown][] = [
    ["Job no.", 12, (l) => text(l.job.job_no)],
    ["Status", 12, (l) => text(STATUS_LABEL[l.job.status])],
    ["Service", 12, (l) => text(pretty(l.job.service_type))],
    ["Client", 30, (l) => text(l.job.clients?.name)],
    ["Shipper", 30, (l) => text(l.s.shipper)],
    ["Consignee", 30, (l) => text(l.s.consignee)],
    ["BL / AWB no.", 18, (l) => text(l.bl)],
    ["Entry no.", 16, (l) => text(l.job.entry_no)],
    ["Containers", 24, (l) => text(l.containers.join(", "))],
    ["Vessel", 20, (l) => text(l.vessel)],
    ["Voyage", 10, (l) => text(l.voyage)],
    ["ETA", 12, (l) => date(l.job.eta)],
    ["Shipped on board", 16, (l) => date(l.s.shippedOnBoard)],
    ["Port of loading", 18, (l) => text(l.s.portOfLoading)],
    ["Port of discharge", 18, (l) => text(l.pod)],
    ["Packages", 10, (l) => number(l.s.packages)],
    ["Package type", 12, (l) => text(l.s.packageType)],
    ["Gross weight", 14, (l) => number(l.s.grossWeight, "#,##0.00")],
    ["Weight unit", 10, (l) => text(l.s.weightUnit)],
    ["Goods", 50, (l) => text(l.s.goods)],
    ["Invoice no.", 18, (l) => text(l.s.invoiceNos.join(", "))],
    ["Currency", 9, (l) => text(l.s.currency)],
    ["Invoice total", 16, (l) => (l.s.invoiceTotal != null ? number(l.s.invoiceTotal, "#,##0.00") : text(l.s.invoiceTotalsText))],
    ["SPS no.", 20, (l) => text(l.s.spsNos.join(", "))],
    ["SPS must ship out", 16, (l) => date(l.s.spsMustShipOut)],
    ["SPS quantity", 16, (l) => text(l.s.spsQuantity)],
    ["Scan errors", 11, (l) => number(l.scan?.error_count ?? null)],
    ["Scan warnings", 13, (l) => number(l.scan?.warning_count ?? null)],
    ["Documents", 10, (l) => number(l.job.job_documents?.length ?? 0)],
    ["Created", 12, (l) => date(localDay(l.job.created_at))],
  ];
  const data = [columns.map(([h]) => head(h)), ...lines.map((l) => columns.map(([, , get]) => get(l)))];
  const stamp = new Date().toISOString().slice(0, 10);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await writeExcelFile(data as any, { columns: columns.map(([, width]) => ({ width })), stickyRowsCount: 1, sheet: "Shipments" })
    .toFile(`VSA shipments ${stamp}.xlsx`);
}

export default function Shipments() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    supabase.from("jobs")
      .select("*, clients(name), job_documents(doc_type, extracted), scan_results(error_count, warning_count, run_at)")
      .order("created_at", { ascending: false })
      .then(({ data, error }) => {
        if (error) setError(error.message);
        setRows((data as Row[]) ?? []);
        setLoading(false);
      });
  }, []);

  const lines = useMemo(() => rows.map(toLine), [rows]);
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return lines;
    return lines.filter((l) =>
      [l.job.job_no, l.job.clients?.name, l.s.shipper, l.s.consignee, l.bl, l.job.entry_no, l.vessel, l.s.goods, ...l.containers, ...l.s.invoiceNos]
        .some((v) => v?.toLowerCase().includes(needle)));
  }, [lines, q]);

  async function doExport() {
    setExporting(true);
    setError("");
    try {
      await exportXlsx(shown);
    } catch (e) {
      setError(`Could not create the spreadsheet: ${(e as Error).message}`);
    }
    setExporting(false);
  }

  return (
    <>
      <div className="row spread">
        <h1>Summary of shipments</h1>
        <div className="row">
          <input placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
          <button disabled={exporting || shown.length === 0} onClick={doExport}>
            {exporting ? "Preparing…" : `Export ${shown.length} to Excel`}
          </button>
        </div>
      </div>
      <p className="muted small">
        Shipper, consignee, cargo and invoice figures are read from the uploaded documents. Check them against the originals before filing.
      </p>
      {error && <p className="error">{error}</p>}
      {loading ? <p className="muted">Loading…</p> : lines.length === 0 ? <p className="muted">No shipments yet.</p> : (
        <section className="card">
          <table className="wide-table">
            <thead>
              <tr>
                <th>Job</th><th>Status</th><th>Client</th><th>Shipper</th><th>BL / AWB</th><th>Containers</th>
                <th>Vessel / voyage</th><th>ETA</th><th>Discharge</th><th className="num">Packages</th>
                <th className="num">Gross weight</th><th>Goods</th><th>Invoice</th><th className="num">Invoice total</th><th>SPS must ship out</th><th>Scan</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((l) => (
                <tr key={l.job.id}>
                  <td><Link to={`/jobs/${l.job.id}`}>{l.job.job_no}</Link></td>
                  <td>{STATUS_LABEL[l.job.status]}</td>
                  <td>{l.job.clients?.name}</td>
                  <td>{l.s.shipper}</td>
                  <td>{l.bl}</td>
                  <td>{l.containers.join(", ")}</td>
                  <td>{[l.vessel, l.voyage].filter(Boolean).join(" / ")}</td>
                  <td className="nowrap">{l.job.eta}</td>
                  <td>{l.pod}</td>
                  <td className="num">{n(l.s.packages)} {l.s.packageType}</td>
                  <td className="num">{n(l.s.grossWeight)} {l.s.grossWeight != null && l.s.weightUnit}</td>
                  <td className="clip" title={l.s.goods ?? ""}>{l.s.goods}</td>
                  <td>{l.s.invoiceNos.join(", ")}</td>
                  <td className="num">{l.s.invoiceTotal != null ? `${l.s.currency ?? ""} ${n(l.s.invoiceTotal)}` : l.s.invoiceTotalsText}</td>
                  <td className="nowrap">{l.s.spsMustShipOut}</td>
                  <td className="nowrap">
                    {!l.scan ? <span className="muted">Not scanned</span>
                      : l.scan.error_count ? <span className="error">{l.scan.error_count} error(s)</span>
                      : l.scan.warning_count ? <span className="warn">{l.scan.warning_count} warning(s)</span>
                      : <span className="ok">OK</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {shown.length === 0 && <p className="muted">Nothing matches the search.</p>}
        </section>
      )}
    </>
  );
}
