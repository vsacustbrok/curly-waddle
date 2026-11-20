// BIR books: the office's BIR registration details (owner), and the monthly Sales Book, Collections
// Book and VAT summary from the issued documents, with Excel files for the accountant.
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { dayLabel } from "../lib/types";
import { DOC_TITLE, amount, collectionsBook, missingSetup, salesBook, vatSummary, type BirDoc, type BirSettings, type BookRow } from "../lib/bir";

type Tab = "books" | "details";
const thisMonth = () => new Date().toISOString().slice(0, 7);

async function downloadBooks(month: string, docs: BirDoc[]) {
  const { default: writeExcelFile } = await import("write-excel-file/browser");
  const sheet = (rows: BookRow[], name: string) => {
    if (!rows.length) return { data: [[{ value: "No documents this month" }]], sheet: name, columns: [{ width: 30 }] };
    const heads = Object.keys(rows[0]);
    return {
      sheet: name,
      columns: heads.map((h) => ({ width: Math.max(12, Math.min(40, h.length + 6)) })),
      data: [heads.map((h) => ({ value: h, fontWeight: "bold" as const })),
        ...rows.map((r) => heads.map((h) => ({ value: r[h] ?? "", type: typeof r[h] === "number" ? Number : String, ...(typeof r[h] === "number" ? { format: "#,##0.00" } : {}) })))],
    };
  };
  const s = vatSummary(docs);
  const summary = [
    [{ value: `VAT summary ${month}`, fontWeight: "bold" as const }],
    ...([["Invoices issued", s.invoices], ["Invoices voided", s.voided], ["VATable sales", s.vatable], ["Output VAT (12%)", s.vat],
      ["VAT-exempt sales", s.exempt], ["Zero-rated sales", s.zero], ["Total invoiced", s.total], ["Collected (cash / check)", s.collected],
      ["Tax withheld by clients (2307)", s.ewt]] as [string, number][]).map(([k, v]) => [{ value: k }, { value: v, type: Number, format: "#,##0.00" }]),
  ];
  const sheets = [sheet(salesBook(docs), "Sales Book"), sheet(collectionsBook(docs), "Collections Book"),
    { sheet: "VAT summary", data: summary, columns: [{ width: 34 }, { width: 18 }] }];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await writeExcelFile(sheets as any).toFile(`VSA BIR books ${month}.xlsx`);
}

export default function BirBooks() {
  const { profile } = useAuth();
  const isOwner = profile!.role === "owner";
  const [tab, setTab] = useState<Tab>("books");
  const [month, setMonth] = useState(thisMonth());
  const [docs, setDocs] = useState<BirDoc[]>([]);
  const [settings, setSettings] = useState<BirSettings | null>(null);
  const [form, setForm] = useState<Record<string, string | boolean>>({});
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase.from("bir_settings").select("*").maybeSingle().then(({ data, error }) => {
      if (error) setError(error.message);
      const s = data as BirSettings | null;
      setSettings(s);
      if (s) setForm(Object.fromEntries(Object.entries(s).map(([k, v]) => [k, typeof v === "boolean" ? v : v == null ? "" : String(v)])));
    });
  }, []);
  useEffect(() => {
    const [y, m] = month.split("-").map(Number);
    const end = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
    supabase.from("bir_documents").select("*, jobs(job_no)").gte("issued_on", `${month}-01`).lte("issued_on", end).order("serial_no")
      .then(({ data, error }) => { if (error) setError(error.message); setDocs((data as BirDoc[]) ?? []); });
  }, [month]);

  const sum = useMemo(() => vatSummary(docs), [docs]);
  const invoices = docs.filter((d) => d.doc_type === "invoice");
  const receipts = docs.filter((d) => d.doc_type === "receipt");

  async function save(e: FormEvent) {
    e.preventDefault();
    setError(""); setNotice("");
    const num = (k: string) => (String(form[k] ?? "").trim() ? Number(form[k]) : null);
    const row = {
      registered_name: String(form.registered_name ?? "").trim() || null, trade_name: String(form.trade_name ?? "").trim() || null,
      tin: String(form.tin ?? "").trim() || null, branch_code: String(form.branch_code ?? "").trim() || "00000",
      address: String(form.address ?? "").trim() || null, vat_registered: form.vat_registered !== false,
      permit_no: String(form.permit_no ?? "").trim() || null, permit_date: String(form.permit_date ?? "") || null,
      invoice_prefix: String(form.invoice_prefix ?? "").trim(), invoice_from: num("invoice_from"), invoice_to: num("invoice_to"),
      receipt_prefix: String(form.receipt_prefix ?? "").trim(), receipt_from: num("receipt_from"), receipt_to: num("receipt_to"),
    };
    for (const k of ["invoice_from", "invoice_to", "receipt_from", "receipt_to"] as const) {
      const v = row[k];
      if (v != null && (!Number.isInteger(v) || v < 1)) { setError("Number series must be whole numbers from 1."); return; }
    }
    setBusy(true);
    const { error } = await supabase.from("bir_settings").update(row).eq("id", true);
    setBusy(false);
    if (error) { setError(error.message.includes("check") ? "The last number of a series must not be lower than the first." : error.message); return; }
    setSettings({ ...(settings as BirSettings), ...row });
    setNotice("BIR details saved.");
  }

  const field = (k: string, label: string, props: Record<string, unknown> = {}) => (
    <label>{label}<input value={String(form[k] ?? "")} disabled={!isOwner} onChange={(e) => setForm({ ...form, [k]: e.target.value })} {...props} /></label>
  );
  const notReady = [...new Set([...missingSetup(settings, "invoice"), ...missingSetup(settings, "receipt")])];

  return (
    <>
      <h1>BIR books</h1>
      <div className="tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === "books"} className={tab === "books" ? "active" : ""} onClick={() => setTab("books")}>Monthly books</button>
        <button type="button" role="tab" aria-selected={tab === "details"} className={tab === "details" ? "active" : ""} onClick={() => setTab("details")}>BIR details</button>
      </div>
      {error && <p className="error">{error}</p>}
      {notice && <p className="ok" role="status">{notice}</p>}
      {notReady.length > 0 && (
        <p className="warn">Sales invoices and collection receipts cannot be issued yet. Missing: {notReady.join(", ")}.{" "}
          {tab === "books" && <button type="button" className="link" onClick={() => setTab("details")}>Fill in the BIR details</button>}</p>
      )}

      {tab === "books" ? (
        <>
          <section className="card">
            <div className="row spread wrap">
              <label className="row">Month <input type="month" value={month} onChange={(e) => setMonth(e.target.value || thisMonth())} /></label>
              <button type="button" onClick={() => downloadBooks(month, docs).catch((e) => setError(String(e.message ?? e)))}>Download Excel for the accountant</button>
            </div>
            <div className="tiles">
              <div className="tile"><span>VATable sales</span><strong>₱ {amount(sum.vatable)}</strong></div>
              <div className="tile"><span>Output VAT (12%)</span><strong>₱ {amount(sum.vat)}</strong></div>
              <div className="tile"><span>VAT-exempt sales</span><strong>₱ {amount(sum.exempt)}</strong></div>
              <div className="tile"><span>Total invoiced</span><strong>₱ {amount(sum.total)}</strong></div>
              <div className="tile"><span>Collected</span><strong>₱ {amount(sum.collected)}</strong></div>
              <div className="tile"><span>Withheld by clients (2307)</span><strong>₱ {amount(sum.ewt)}</strong></div>
            </div>
            <p className="muted small">{sum.invoices} invoice(s) issued{sum.voided ? `, ${sum.voided} void` : ""}. Void documents keep their number and count as zero. Have your accountant confirm the figures before filing.</p>
          </section>
          {[["Sales Book", invoices], ["Collections Book", receipts]].map(([title, list]) => (
            <section className="card" key={title as string}>
              <h2>{title as string} <span className="count">{(list as BirDoc[]).length}</span></h2>
              {(list as BirDoc[]).length === 0 ? <p className="muted">None this month.</p> : (
                <div className="table-scroll">
                  <table className="small">
                    <thead><tr><th>Date</th><th>No.</th><th>{title === "Sales Book" ? "Customer" : "Received from"}</th><th>PN</th><th className="num">Amount</th><th>Status</th></tr></thead>
                    <tbody>
                      {(list as BirDoc[]).map((d) => (
                        <tr key={d.id} className={d.voided ? "voided" : ""}>
                          <td className="nowrap">{dayLabel(d.issued_on)}</td>
                          <td className="nowrap"><Link to={`/bir/${d.id}`} target="_blank">{d.doc_no}</Link></td>
                          <td>{d.buyer_name}</td>
                          <td className="nowrap">{d.jobs?.job_no && <Link to={`/jobs/${d.job_id}`}>{d.jobs.job_no}</Link>}</td>
                          <td className="num">{d.voided ? "0.00" : amount(d.total)}</td>
                          <td>{d.voided ? <span className="badge void" title={d.void_reason ?? ""}>VOID</span> : DOC_TITLE[d.doc_type]}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          ))}
        </>
      ) : (
        <form className="card" onSubmit={save}>
          <h2>BIR registration details</h2>
          <p className="muted small">Printed on every sales invoice and collection receipt. Copy them exactly from your BIR Certificate of Registration (Form 2303) and the permit or acknowledgement certificate for computer-printed invoices.{!isOwner && " Only the owner can change them."}</p>
          <div className="grid">
            {field("registered_name", "Registered name")}
            {field("trade_name", "Business / trade name (if different)")}
            {field("tin", "TIN", { placeholder: "000-000-000" })}
            {field("branch_code", "Branch code", { placeholder: "00000" })}
            <label className="wide">Registered address<input value={String(form.address ?? "")} disabled={!isOwner} onChange={(e) => setForm({ ...form, address: e.target.value })} /></label>
            <label className="check"><input type="checkbox" checked={form.vat_registered !== false} disabled={!isOwner} onChange={(e) => setForm({ ...form, vat_registered: e.target.checked })} /> VAT-registered (12% VAT shown on invoices)</label>
            {field("permit_no", "BIR permit / acknowledgement certificate no.")}
            <label>Date issued<input type="date" value={String(form.permit_date ?? "")} disabled={!isOwner} onChange={(e) => setForm({ ...form, permit_date: e.target.value })} /></label>
          </div>
          <h3>Number series registered with BIR</h3>
          <div className="grid">
            {field("invoice_prefix", "Sales invoice prefix", { placeholder: "e.g. SI-" })}
            {field("invoice_from", "Sales invoice: first no.", { inputMode: "numeric" })}
            {field("invoice_to", "Sales invoice: last no.", { inputMode: "numeric" })}
            {field("receipt_prefix", "Collection receipt prefix", { placeholder: "e.g. CR-" })}
            {field("receipt_from", "Collection receipt: first no.", { inputMode: "numeric" })}
            {field("receipt_to", "Collection receipt: last no.", { inputMode: "numeric" })}
          </div>
          <p className="muted small">Numbers are given by the system in order, never skipped or reused. When a series is used up, issuing stops until a new series is entered.</p>
          {isOwner && <button disabled={busy}>{busy ? "Saving…" : "Save BIR details"}</button>}
        </form>
      )}
    </>
  );
}
