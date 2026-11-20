// A BIR document laid out for printing: a Sales Invoice (VSA's services, with the VAT breakdown) or a
// Collection Receipt (a payment received). /bir/:id shows an issued document as it was issued, from the
// copy saved with it; /jobs/:id/invoice-preview shows a SPECIMEN from the current charges, with no number.
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { dayLabel } from "../lib/types";
import { CHARGE_LABEL, vatOf, type Charge } from "../lib/billing";
import { DOC_TITLE, amount, pesoWords, tinWithBranch, type BirDoc, type BirSettings } from "../lib/bir";

type Shown = Pick<BirDoc, "doc_type" | "doc_no" | "issued_on" | "buyer_name" | "buyer_tin" | "buyer_address" | "lines" | "vatable_sales"
  | "vat_amount" | "exempt_sales" | "zero_rated" | "total" | "amount_received" | "ewt_amount" | "seller" | "voided" | "void_reason"
  | "issued_by_name"> & { pn?: string; specimen?: boolean };

export default function BirPrint() {
  const { id, jobId } = useParams();
  const [doc, setDoc] = useState<Shown | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (id) {
      supabase.from("bir_documents").select("*, jobs(job_no)").eq("id", Number(id)).maybeSingle().then(({ data, error }) => {
        if (error || !data) { setError(error?.message ?? "Document not found."); return; }
        const d = data as BirDoc;
        setDoc({ ...d, pn: d.jobs?.job_no });
      });
      return;
    }
    // Specimen: the service charges not on an invoice yet, with the office's current BIR details.
    Promise.all([
      supabase.from("jobs").select("job_no, clients(name, tin, address)").eq("id", jobId!).maybeSingle(),
      supabase.from("charges").select("*").eq("job_id", jobId!).is("invoice_id", null).eq("advance", false).order("id"),
      supabase.from("bir_settings").select("*").maybeSingle(),
    ]).then(([j, c, s]) => {
      if (!j.data) { setError("Shipment not found."); return; }
      const settings = (s.data ?? {}) as BirSettings;
      const vatReg = settings.vat_registered !== false;
      const charges = (c.data as Charge[]) ?? [];
      const raw = (j.data as unknown as { clients?: unknown }).clients;
      const client = (Array.isArray(raw) ? raw[0] : raw) as { name: string; tin: string | null; address: string | null } | null | undefined;
      const lines = charges.map((x) => ({ description: x.description?.trim() || CHARGE_LABEL[x.kind], amount: Number(x.amount), vatable: x.vatable && vatReg }));
      const vatable = lines.filter((l) => l.vatable).reduce((a, l) => a + l.amount, 0);
      const vat = charges.filter((x) => x.vatable && vatReg).reduce((a, x) => a + vatOf(x), 0);
      const exempt = lines.filter((l) => !l.vatable).reduce((a, l) => a + l.amount, 0);
      setDoc({
        doc_type: "invoice", doc_no: "SPECIMEN", issued_on: new Date().toISOString().slice(0, 10), specimen: true,
        buyer_name: client?.name ?? "", buyer_tin: client?.tin ?? null, buyer_address: client?.address ?? null,
        lines, vatable_sales: vatable, vat_amount: vat, exempt_sales: exempt, zero_rated: 0, total: vatable + vat + exempt,
        amount_received: null, ewt_amount: 0, seller: settings, voided: false, void_reason: null, issued_by_name: null,
        pn: (j.data as { job_no: string }).job_no,
      });
    });
  }, [id, jobId]);

  if (error) return <p className="error">{error}</p>;
  if (!doc) return <p className="muted">Loading…</p>;
  const s = doc.seller;
  const invoice = doc.doc_type === "invoice";
  const vatReg = s.vat_registered !== false;
  const series = invoice ? [s.invoice_prefix, s.invoice_from, s.invoice_to] : [s.receipt_prefix, s.receipt_from, s.receipt_to];
  const pad = (n: unknown) => String(n ?? "").padStart(6, "0");

  return (
    <>
      <div className="row no-print">
        <Link to={-1 as unknown as string} onClick={(e) => { e.preventDefault(); history.back(); }}>‹ Back</Link>
        <button type="button" onClick={() => window.print()}>Print</button>
        {doc.specimen && <span className="muted small">Specimen only: this has no number and is not valid. Issue the invoice from the Billing section.</span>}
      </div>
      <article className={"bir-doc" + (doc.voided ? " is-void" : "") + (doc.specimen ? " is-specimen" : "")}>
        {(doc.voided || doc.specimen) && <div className="bir-stamp" aria-hidden="true">{doc.voided ? "VOID" : "SPECIMEN"}</div>}
        <header className="bir-head">
          <div>
            <strong className="bir-name">{s.registered_name || "(registered name — set in BIR details)"}</strong>
            {s.trade_name && <div>{s.trade_name}</div>}
            <div>{s.address || "(registered address)"}</div>
            <div>{vatReg ? "VAT" : "NON-VAT"} Reg. TIN: {s.tin ? tinWithBranch(s) : "(TIN)"}</div>
          </div>
          <div className="bir-title">
            <h1>{DOC_TITLE[doc.doc_type].toUpperCase()}</h1>
            <div className="bir-no">No. <strong>{doc.doc_no}</strong></div>
            <div>Date: {dayLabel(doc.issued_on)}</div>
          </div>
        </header>

        <section className="bir-buyer">
          <div><span>{invoice ? "Sold to" : "Received from"}</span><strong>{doc.buyer_name}</strong></div>
          <div><span>TIN</span>{doc.buyer_tin ?? ""}</div>
          <div className="wide"><span>Address</span>{doc.buyer_address ?? ""}</div>
          {doc.pn && <div><span>Our ref. (PN)</span>{doc.pn}</div>}
        </section>

        {invoice ? (
          <>
            <table className="bir-lines">
              <thead><tr><th>Description of services</th><th className="num">Amount (₱)</th></tr></thead>
              <tbody>
                {doc.lines.map((l, i) => <tr key={i}><td>{l.description}{vatReg && !l.vatable ? " (VAT-exempt)" : ""}</td><td className="num">{amount(l.amount)}</td></tr>)}
                {Array.from({ length: Math.max(0, 6 - doc.lines.length) }, (_, i) => <tr key={`b${i}`} className="blank"><td>&nbsp;</td><td></td></tr>)}
              </tbody>
            </table>
            <table className="bir-totals">
              <tbody>
                {vatReg ? <>
                  <tr><td>VATable sales</td><td className="num">{amount(doc.vatable_sales)}</td></tr>
                  <tr><td>VAT (12%)</td><td className="num">{amount(doc.vat_amount)}</td></tr>
                  <tr><td>VAT-exempt sales</td><td className="num">{amount(doc.exempt_sales)}</td></tr>
                  <tr><td>Zero-rated sales</td><td className="num">{amount(doc.zero_rated)}</td></tr>
                </> : null}
                <tr className="grand"><td>TOTAL AMOUNT DUE</td><td className="num">₱ {amount(doc.total)}</td></tr>
              </tbody>
            </table>
            <p className="bir-words">Amount in words: {pesoWords(Number(doc.total))}</p>
          </>
        ) : (
          <section className="bir-receipt">
            <p>Received the sum of <strong>{pesoWords(Number(doc.amount_received ?? 0))}</strong> (₱ {amount(doc.amount_received)})</p>
            <p>in payment of: {doc.lines[0]?.description}</p>
            <table className="bir-totals">
              <tbody>
                <tr><td>Cash / check received</td><td className="num">{amount(doc.amount_received)}</td></tr>
                <tr><td>Tax withheld by the client (BIR Form 2307)</td><td className="num">{amount(doc.ewt_amount)}</td></tr>
                <tr className="grand"><td>TOTAL SETTLED</td><td className="num">₱ {amount(doc.total)}</td></tr>
              </tbody>
            </table>
            <p className="bir-supp">THIS DOCUMENT IS NOT VALID FOR CLAIM OF INPUT TAX.</p>
          </section>
        )}

        <footer className="bir-foot">
          <div className="bir-sign"><span className="line" />Authorized signature{doc.issued_by_name ? ` (issued by ${doc.issued_by_name})` : ""}</div>
          <div className="bir-reg small">
            <div>BIR Permit / Acknowledgement Certificate No.: {s.permit_no || "—"}{s.permit_date ? ` · Date issued: ${dayLabel(s.permit_date)}` : ""}</div>
            <div>Series: {series[1] ? `${series[0] ?? ""}${pad(series[1])} to ${series[0] ?? ""}${pad(series[2])}` : "—"}</div>
          </div>
          {doc.voided && <p className="error small">VOID: {doc.void_reason}</p>}
        </footer>
      </article>
    </>
  );
}
