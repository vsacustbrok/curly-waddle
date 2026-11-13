// Printing a shipment's Billing Statement or Statement of Charges onto VSA's pre-printed official forms.
// Only the filled-in information prints; the scanned form shows behind it on screen so the draft can be
// checked first. Positions are in millimetres on A4, measured from the office's own forms.
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { dayLabel, type Job } from "../lib/types";
import { CHARGE_KINDS, CHARGE_LABEL, money, totals, type Charge } from "../lib/billing";
import { summarize } from "../lib/shipment";

type FormKind = "billing" | "soc";
type Box = { x: number; y: number; w: number; h?: number; size?: number; align?: "left" | "center" | "right" };
type FieldKey = "billedTo" | "tin" | "address" | "date" | "voyage" | "arrival" | "delivered" | "mbl" | "hbl" | "fromTo" | "projectNo" | "pcs" | "weight" | "description" | "preparedBy";
type Mode = "airExport" | "airImport" | "seaExport" | "seaImport";

type Layout = {
  title: string; image: string; fields: Record<FieldKey, Box>; checks: Record<Mode, [number, number]>;
  lines: { x: number; w: number; amountRight: number; tops: number[]; height: number }; total: Box;
};

// Billing Statement: 24 ruled rows under PARTICULARS (4.33 mm apart from 89.9 mm), amount column from 129.7 mm.
const BILLING_TOPS = [...Array.from({ length: 23 }, (_, k) => 89.9 + 4.33 * k), 189.5];
// Statement of Charges: no ruled rows; 21 rows of 5.5 mm between 108.7 mm and 227.4 mm.
const SOC_TOPS = Array.from({ length: 21 }, (_, k) => 110.6 + 5.5 * k);

const LAYOUTS: Record<FormKind, Layout> = {
  billing: {
    title: "Billing Statement", image: "/forms/billing-statement.webp",
    fields: {
      billedTo: { x: 37, y: 36.6, w: 90 }, tin: { x: 37, y: 41.7, w: 90 }, address: { x: 37, y: 46.7, w: 91, size: 8 },
      date: { x: 141, y: 45.7, w: 58 },
      voyage: { x: 14, y: 57.2, w: 49 }, arrival: { x: 111.3, y: 52.4, w: 18, size: 8 }, delivered: { x: 91, y: 57.3, w: 38 },
      mbl: { x: 131, y: 57.2, w: 39 }, hbl: { x: 171.5, y: 57.2, w: 29.5, size: 8 },
      fromTo: { x: 14, y: 67.8, w: 114 }, projectNo: { x: 88, y: 62.5, w: 40 },
      pcs: { x: 131, y: 67.8, w: 39 }, weight: { x: 171.5, y: 67.8, w: 29.5, size: 8 },
      description: { x: 36, y: 72.3, w: 92, h: 9.8, size: 8.5 },
      preparedBy: { x: 114, y: 208.2, w: 36, align: "center", size: 8.5 },
    },
    checks: { airExport: [134.2, 75.0], airImport: [134.2, 79.8], seaExport: [175.5, 75.0], seaImport: [175.5, 79.8] },
    lines: { x: 15, w: 112, amountRight: 199, tops: BILLING_TOPS, height: 4.33 },
    total: { x: 131, y: 197.8, w: 68, align: "right", size: 10 },
  },
  soc: {
    title: "Statement of Charges", image: "/forms/statement-of-charges.webp",
    fields: {
      billedTo: { x: 31, y: 50.2, w: 95 }, address: { x: 12, y: 55.3, w: 114, size: 8 }, tin: { x: 12, y: 60.3, w: 114 },
      date: { x: 139.5, y: 58.0, w: 59 },
      voyage: { x: 11, y: 71.3, w: 52 }, arrival: { x: 110.5, y: 66.2, w: 16.5, size: 8 }, delivered: { x: 96, y: 71.0, w: 31 },
      mbl: { x: 129.5, y: 71.3, w: 39 }, hbl: { x: 170.5, y: 71.3, w: 29, size: 8 },
      fromTo: { x: 11, y: 82.9, w: 115 }, projectNo: { x: 86, y: 77.6, w: 41 },
      pcs: { x: 129.5, y: 82.9, w: 39 }, weight: { x: 170.5, y: 82.9, w: 29, size: 8 },
      description: { x: 33, y: 89.2, w: 94, h: 11, size: 8.5 },
      preparedBy: { x: 112, y: 244.2, w: 36, align: "center", size: 8.5 },
    },
    checks: { airExport: [131.3, 92.2], airImport: [131.3, 98.2], seaImport: [172.1, 92.2], seaExport: [172.1, 98.2] },
    lines: { x: 24, w: 102, amountRight: 197, tops: SOC_TOPS, height: 5.5 },
    total: { x: 129, y: 230.4, w: 68, align: "right", size: 10 },
  },
};

const FIELD_LABEL: Record<FieldKey, string> = {
  billedTo: "Billed to / customer", tin: "TIN", address: "Address", date: "Date", voyage: "Flight no. / voy. no.",
  arrival: "Date of departure / arrival", delivered: "Delivered date", mbl: "MAWB / MBL", hbl: "HAWBL / MBL", fromTo: "From / to",
  projectNo: "Project no.", pcs: "No. of pcs.", weight: "Weight / dimension", description: "Description", preparedBy: "Prepared by",
};
const MODE_LABEL: Record<Mode, string> = { airExport: "Air export", airImport: "Air import", seaExport: "Sea export", seaImport: "Sea import" };

type Line = { text: string; amount: string };
/**
 * Charges as form lines: the same category on consecutive rows, one empty row between categories,
 * then the VAT line. Empty rows are dropped first if the form runs out of rows.
 */
function buildLines(charges: Charge[], rows: number): { lines: Line[]; overflow: boolean } {
  const groups = CHARGE_KINDS.map((k) => charges.filter((c) => c.kind === k)).filter((g) => g.length);
  const out: Line[] = [];
  groups.forEach((g, i) => {
    if (i > 0) out.push({ text: "", amount: "" });
    for (const c of g) out.push({ text: CHARGE_LABEL[c.kind] + (c.description ? ` — ${c.description}` : ""), amount: money(Number(c.amount)) });
  });
  const vat = totals(charges, []).vat;
  if (vat > 0) out.push({ text: "", amount: "" }, { text: "Add: 12% VAT", amount: money(vat) });
  if (out.length <= rows) return { lines: out, overflow: false };
  const packed = out.filter((l) => l.text || l.amount);
  return { lines: packed.slice(0, rows), overflow: packed.length > rows };
}

const OFFSET_KEY = (f: FormKind) => `vsa-form-offset-${f}`;
const readOffset = (f: FormKind) => {
  try { const v = JSON.parse(localStorage.getItem(OFFSET_KEY(f)) ?? "null"); if (v && typeof v.x === "number") return v as { x: number; y: number }; } catch { /* none */ }
  return { x: 0, y: 0 };
};

export default function FormPrint() {
  const { id, form: formParam } = useParams();
  const form: FormKind = formParam === "soc" ? "soc" : "billing";
  const L = LAYOUTS[form];
  const { profile } = useAuth();
  const [job, setJob] = useState<Job | null>(null);
  const [charges, setCharges] = useState<Charge[]>([]);
  const [error, setError] = useState("");
  const [values, setValues] = useState<Record<FieldKey, string> | null>(null);
  const [mode, setMode] = useState<Mode | "">("seaImport");
  const [lines, setLines] = useState<Line[]>([]);
  const [overflow, setOverflow] = useState(false);
  const [offset, setOffset] = useState(() => readOffset(form));
  const [withForm, setWithForm] = useState(false);
  const [showGuide, setShowGuide] = useState(true);

  useEffect(() => { setOffset(readOffset(form)); }, [form]);
  useEffect(() => { try { localStorage.setItem(OFFSET_KEY(form), JSON.stringify(offset)); } catch { /* not saved */ } }, [form, offset]);

  useEffect(() => {
    Promise.all([
      supabase.from("jobs").select("*, clients(name, address, tin)").eq("id", id!).maybeSingle(),
      supabase.from("charges").select("*").eq("job_id", id!).order("id"),
      supabase.from("job_documents").select("doc_type, extracted").eq("job_id", id!),
    ]).then(([j, c, d]) => {
      if (j.error || !j.data) { setError(j.error?.message ?? "Shipment not found."); return; }
      const job = j.data as Job;
      setJob(job);
      setCharges((c.data as Charge[]) ?? []);
      // Port of loading, packages and weight come from the documents, when the document check has read them.
      const s = summarize((d.data ?? []) as Parameters<typeof summarize>[0]);
      const boxes = job.containers ?? [];
      setValues({
        billedTo: job.clients?.name ?? "", tin: job.clients?.tin ?? "", address: (job.clients?.address ?? "").replace(/\s*\n\s*/g, ", "),
        date: dayLabel(job.billed_on ?? new Date().toISOString().slice(0, 10)) ?? "",
        voyage: [job.vessel ?? s.vessel, job.voyage ?? s.voyage].filter(Boolean).join(" / "), arrival: dayLabel(job.eta) ?? "",
        delivered: job.released_at ? dayLabel(job.released_at.slice(0, 10)) ?? "" : "",
        mbl: job.bl_awb_no ?? "", hbl: "",
        fromTo: [s.portOfLoading, job.port_of_discharge ?? s.portOfDischarge].filter(Boolean).join(" / "), projectNo: job.job_no,
        pcs: [s.packages != null ? `${s.packages.toLocaleString()} ${s.packageType ?? ""}`.trim() : "", boxes.length ? `${boxes.length} CNTR` : ""].filter(Boolean).join(" / "),
        weight: s.grossWeight != null ? `${s.grossWeight.toLocaleString()} ${s.weightUnit ?? "KGS"}` : "",
        description: [job.item_description, boxes.length ? boxes.join(", ") : ""].filter(Boolean).join(" — "),
        preparedBy: profile?.full_name ?? "",
      });
      setMode(job.bl_awb_no && !boxes.length && /^\d{3}-?\d{8}$/.test(job.bl_awb_no) ? "airImport" : "seaImport");
    });
  }, [id, profile?.full_name]);

  // Billing Statement: VSA's own charges (and their VAT). Statement of Charges: advances paid for the client.
  const formCharges = useMemo(() => charges.filter((c) => (form === "soc" ? c.advance : !c.advance)), [charges, form]);
  useEffect(() => {
    const b = buildLines(formCharges, L.lines.tops.length);
    setLines(b.lines); setOverflow(b.overflow);
  }, [formCharges, L.lines.tops.length]);
  // The total follows the lines as printed, including any amount corrected by hand.
  const total = Math.round(lines.reduce((sum, l) => sum + (Number(l.amount.replace(/[^0-9.-]/g, "")) || 0), 0) * 100) / 100;

  if (error) return <p className="error">{error}</p>;
  if (!job || !values) return <p className="muted">Loading…</p>;

  const box = (b: Box, extra: CSSProperties = {}): CSSProperties => ({
    left: `${b.x}mm`, top: `${b.y}mm`, width: `${b.w}mm`, height: b.h ? `${b.h}mm` : undefined,
    fontSize: `${b.size ?? 9}pt`, textAlign: b.align ?? "left", ...extra,
  });
  const edit = (k: FieldKey) => (
    <div key={k} className={"ff" + (L.fields[k].h ? " wrap" : "")} style={box(L.fields[k])} contentEditable suppressContentEditableWarning
      title={FIELD_LABEL[k]} onBlur={(e) => setValues({ ...values, [k]: e.currentTarget.innerText })}>{values[k]}</div>
  );
  const setLine = (i: number, patch: Partial<Line>) => setLines(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const nudge = (dx: number, dy: number) => setOffset({ x: Math.round((offset.x + dx) * 10) / 10, y: Math.round((offset.y + dy) * 10) / 10 });

  return (
    <>
      <div className="form-tools no-print">
        <div className="row wrap">
          <Link to={`/jobs/${job.id}`}>‹ Back to {job.job_no}</Link>
          <Link to={`/jobs/${job.id}/print/billing`} className={form === "billing" ? "tab on" : "tab"}>Billing Statement</Link>
          <Link to={`/jobs/${job.id}/print/soc`} className={form === "soc" ? "tab on" : "tab"}>Statement of Charges</Link>
          <button type="button" onClick={() => window.print()}>Print on the official form</button>
        </div>
        <p className="small muted">
          Draft for checking: the grey form behind is your official paper; only the dark text prints. Click any text to correct it before printing.
          {form === "billing" ? " This form lists VSA's own charges; advances for the client go on the Statement of Charges." : " This form lists the refundable charges paid for the client (charges marked “Advance for client”)."}
        </p>
        <div className="row wrap">
          <label>Shipment type
            <select value={mode} onChange={(e) => setMode(e.target.value as Mode | "")}>
              <option value="">None ticked</option>
              {(Object.keys(MODE_LABEL) as Mode[]).map((m) => <option key={m} value={m}>{MODE_LABEL[m]}</option>)}
            </select>
          </label>
          <span className="small">Line up with the paper:</span>
          <button type="button" className="ghost small" onClick={() => nudge(-0.5, 0)} aria-label="Move left">◀</button>
          <button type="button" className="ghost small" onClick={() => nudge(0, -0.5)} aria-label="Move up">▲</button>
          <button type="button" className="ghost small" onClick={() => nudge(0, 0.5)} aria-label="Move down">▼</button>
          <button type="button" className="ghost small" onClick={() => nudge(0.5, 0)} aria-label="Move right">▶</button>
          <span className="small muted">{offset.x} mm across, {offset.y} mm down</span>
          {(offset.x !== 0 || offset.y !== 0) && <button type="button" className="link small" onClick={() => setOffset({ x: 0, y: 0 })}>Reset</button>}
          <label className="check"><input type="checkbox" checked={showGuide} onChange={(e) => setShowGuide(e.target.checked)} /> Show the form on screen</label>
          <label className="check"><input type="checkbox" checked={withForm} onChange={(e) => setWithForm(e.target.checked)} /> Also print the form (test on plain paper)</label>
        </div>
        {formCharges.length === 0 && <p className="warn small">No {form === "soc" ? "advances for the client" : "service charges"} on this shipment yet. Add them in the shipment's Billing section.</p>}
        {overflow && <p className="error small">More charges than rows on the form: the last ones did not fit. Combine some charges or print a second form.</p>}
        <p className="small muted">Printer settings: paper A4, scale 100% (“Actual size”), margins none, headers and footers off. Print one test page on plain paper with “Also print the form” ticked, hold it against the official form, and use the arrows if it is off.</p>
      </div>

      <div className={"form-sheet" + (withForm ? " with-form" : "") + (showGuide ? "" : " no-guide")}>
        <img className="form-bg" src={L.image} alt={`${L.title} form`} />
        <div className="form-layer" style={{ transform: `translate(${offset.x}mm, ${offset.y}mm)` }}>
          {(Object.keys(L.fields) as FieldKey[]).map(edit)}
          {mode && <div className="ff check-mark" style={{ left: `${L.checks[mode][0] - 1.6}mm`, top: `${L.checks[mode][1] - 2.3}mm` }}>X</div>}
          {lines.map((l, i) => (
            <div key={i}>
              <div className="ff" style={{ left: `${L.lines.x}mm`, top: `${L.lines.tops[i] + 0.55}mm`, width: `${L.lines.w}mm`, fontSize: "9pt" }}
                contentEditable suppressContentEditableWarning onBlur={(e) => setLine(i, { text: e.currentTarget.innerText })}>{l.text}</div>
              <div className="ff" style={{ left: `${L.lines.amountRight - 50}mm`, top: `${L.lines.tops[i] + 0.55}mm`, width: "50mm", textAlign: "right", fontSize: "9pt" }}
                contentEditable suppressContentEditableWarning onBlur={(e) => setLine(i, { amount: e.currentTarget.innerText })}>{l.amount}</div>
            </div>
          ))}
          <div className="ff total" style={box(L.total)}>{money(total)}</div>
        </div>
      </div>
    </>
  );
}
