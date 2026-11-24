// Billing on a shipment: what VSA charges, what the client has paid, and the balance.
// Owner and billing staff record charges and payments; everyone else sees them.
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { dayLabel, type Job, type Role } from "../lib/types";
import {
  CHARGE_KINDS, CHARGE_LABEL, METHOD_LABEL, PAYMENT_METHODS, dueDate, money, peso, totals, vatOf,
  type Charge, type ChargeKind, type Payment, type PaymentMethod,
} from "../lib/billing";
import { today } from "./JobFields";
import { DOC_TITLE, amount, missingSetup, type BirDoc, type BirSettings } from "../lib/bir";

const blankCharge = { kind: "brokerage_fee" as ChargeKind, description: "", amount: "", vatable: true, advance: false };
const blankPayment = { amount: "", paid_on: "", method: "bank_transfer" as PaymentMethod, reference: "", ewt: "" };

export default function BillingSection({ job, role, termsDays, onJobSaved }: {
  job: Job; role: Role; termsDays: number; onJobSaved: () => void;
}) {
  const canBill = role === "owner" || role === "billing";
  const [charges, setCharges] = useState<Charge[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [charge, setCharge] = useState(blankCharge);
  const [payment, setPayment] = useState({ ...blankPayment, paid_on: today() });
  const [soa, setSoa] = useState({ soa_no: job.soa_no ?? "", billed_on: job.billed_on ?? "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [docs, setDocs] = useState<BirDoc[]>([]);
  const [bir, setBir] = useState<BirSettings | null>(null);
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    const [c, p, d, b] = await Promise.all([
      supabase.from("charges").select("*").eq("job_id", job.id).order("id"),
      supabase.from("payments").select("*").eq("job_id", job.id).order("paid_on"),
      supabase.from("bir_documents").select("*").eq("job_id", job.id).order("issued_at"),
      supabase.from("bir_settings").select("*").maybeSingle(),
    ]);
    setError(c.error?.message ?? p.error?.message ?? "");
    setCharges((c.data as Charge[]) ?? []);
    setPayments((p.data as Payment[]) ?? []);
    setDocs((d.data as BirDoc[]) ?? []);
    setBir((b.data as BirSettings | null) ?? null);
  }, [job.id]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { setSoa({ soa_no: job.soa_no ?? "", billed_on: job.billed_on ?? "" }); }, [job.soa_no, job.billed_on]);

  const run = async (fn: () => PromiseLike<{ error: { message: string } | null }>) => {
    setBusy(true); setError("");
    const { error } = await fn();
    setBusy(false);
    if (error) { setError(error.message); return false; }
    return true;
  };

  async function addCharge(e: FormEvent) {
    e.preventDefault();
    const amount = Number(charge.amount.replace(/,/g, ""));
    if (!(amount >= 0)) { setError("Enter the amount as a number, e.g. 3500 or 3,500.00"); return; }
    if (await run(() => supabase.from("charges").insert({ job_id: job.id, kind: charge.kind, description: charge.description.trim() || null, amount, vatable: charge.vatable && !charge.advance, advance: charge.advance }))) {
      setCharge(blankCharge); load();
    }
  }
  async function removeCharge(c: Charge) {
    if (!confirm(`Remove ${CHARGE_LABEL[c.kind]} ${peso(Number(c.amount))}?`)) return;
    if (await run(() => supabase.from("charges").delete().eq("id", c.id))) load();
  }
  async function addPayment(e: FormEvent) {
    e.preventDefault();
    const amount = Number(payment.amount.replace(/,/g, ""));
    const ewt = payment.ewt.trim() ? Number(payment.ewt.replace(/,/g, "")) : 0;
    if (!(amount > 0)) { setError("Enter the amount received as a number above zero."); return; }
    if (!(ewt >= 0)) { setError("Enter the tax withheld as a number, or leave it blank."); return; }
    if (await run(() => supabase.from("payments").insert({ job_id: job.id, amount, ewt_amount: ewt, paid_on: payment.paid_on || today(), method: payment.method, reference: payment.reference.trim() || null }))) {
      setPayment({ ...blankPayment, paid_on: today() }); load();
    }
  }
  async function removePayment(p: Payment) {
    if (!confirm(`Remove the payment of ${peso(Number(p.amount))} on ${dayLabel(p.paid_on)}?`)) return;
    if (await run(() => supabase.from("payments").delete().eq("id", p.id))) load();
  }
  // BIR documents: the database gives the number, checks the BIR details and locks what is covered.
  const docNo = (id: number | null | undefined) => docs.find((d) => d.id === id)?.doc_no;
  const uninvoiced = charges.filter((c) => !c.advance && !c.invoice_id);
  async function issueInvoice() {
    const missing = missingSetup(bir, "invoice");
    if (missing.length) { setError(`Fill in the BIR details first (BIR books → BIR details): ${missing.join(", ")}.`); return; }
    if (!confirm(`Issue a Sales Invoice for ${uninvoiced.length} service charge(s)? It gets the next number and cannot be edited afterwards, only voided.`)) return;
    setBusy(true); setError(""); setNotice("");
    const { data, error } = await supabase.rpc("issue_sales_invoice", { p_job: job.id });
    setBusy(false);
    if (error) { setError(error.message); return; }
    await load();
    setNotice("Sales Invoice issued.");
    window.open(`/bir/${data}`, "_blank", "noopener");
  }
  async function issueReceipt(p: Payment) {
    const missing = missingSetup(bir, "receipt");
    if (missing.length) { setError(`Fill in the BIR details first (BIR books → BIR details): ${missing.join(", ")}.`); return; }
    if (!confirm(`Issue a Collection Receipt for ${peso(Number(p.amount) + Number(p.ewt_amount ?? 0))} received ${dayLabel(p.paid_on)}?`)) return;
    setBusy(true); setError(""); setNotice("");
    const { data, error } = await supabase.rpc("issue_collection_receipt", { p_payment: p.id });
    setBusy(false);
    if (error) { setError(error.message); return; }
    await load();
    setNotice("Collection Receipt issued.");
    window.open(`/bir/${data}`, "_blank", "noopener");
  }
  async function voidDoc(d: BirDoc) {
    const reason = prompt(`Void ${DOC_TITLE[d.doc_type]} ${d.doc_no}? It keeps its number and shows as VOID in the books.\n\nReason:`);
    if (reason == null) return;
    setBusy(true); setError(""); setNotice("");
    const { error } = await supabase.rpc("void_bir_document", { p_doc: d.id, p_reason: reason });
    setBusy(false);
    if (error) { setError(error.message); return; }
    setNotice(`${d.doc_no} is now void. The charges or payment it covered can be corrected and issued again.`);
    load();
  }

  async function saveSoa(e: FormEvent) {
    e.preventDefault();
    if (await run(() => supabase.from("jobs").update({ soa_no: soa.soa_no.trim() || null, billed_on: soa.billed_on || null }).eq("id", job.id))) onJobSaved();
  }

  const t = totals(charges, payments);
  const due = dueDate(job.billed_on, termsDays);
  const overdue = !!due && t.balance > 0 && due < today();
  const pickDate = { onKeyDown: (e: { key: string; preventDefault: () => void }) => { if (e.key !== "Tab") e.preventDefault(); }, onClick: (e: { currentTarget: HTMLInputElement }) => e.currentTarget.showPicker?.() };

  return (
    <section className="card billing">
      <div className="row spread">
        <h2>Billing</h2>
        {charges.length > 0 && (
          <div className="row">
            <Link className="button-like" to={`/jobs/${job.id}/print/billing`}>Print Billing Statement</Link>
            {charges.some((c) => c.advance) && <Link className="button-like" to={`/jobs/${job.id}/print/soc`}>Print Statement of Charges</Link>}
            <Link className="ghost-link" to={`/jobs/${job.id}/soa`}>Plain statement</Link>
          </div>
        )}
      </div>
      {error && <p className="error">{error}</p>}
      {notice && <p className="ok" role="status">{notice}</p>}

      <div className="row stat-row">
        <span className="stat">Billed <strong>{peso(t.total)}</strong></span>
        <span className="stat">Paid <strong>{peso(t.paid)}</strong></span>
        <span className={"stat " + (t.balance > 0 ? (overdue ? "error" : "warn") : "ok")}>Balance <strong>{peso(t.balance)}</strong></span>
        {job.soa_no && <span className="stat">SOA <strong>{job.soa_no}</strong></span>}
        {job.billed_on && <span className="stat">Billed on {dayLabel(job.billed_on)}</span>}
        {due && t.balance > 0 && <span className={"stat " + (overdue ? "error" : "")}>Due {dayLabel(due)}{overdue ? " (overdue)" : ""}</span>}
      </div>

      <h3>Charges</h3>
      {charges.length === 0 ? <p className="muted small">No charges yet.</p> : (
        <table className="small">
          <thead><tr><th>Charge</th><th>Details</th><th className="num">Amount</th><th className="num">VAT 12%</th><th></th><th></th></tr></thead>
          <tbody>
            {charges.map((c) => (
              <tr key={c.id}>
                <td>{CHARGE_LABEL[c.kind]}</td><td>{c.description}</td>
                <td className="num">{money(Number(c.amount))}</td><td className="num">{c.vatable ? money(vatOf(c)) : ""}</td>
                <td className="muted">{c.advance ? "Advance for client" : c.invoice_id ? <span className="badge">Invoice {docNo(c.invoice_id)}</span> : ""}</td>
                <td>{canBill && !c.invoice_id && <button type="button" className="link danger-text" onClick={() => removeCharge(c)}>Remove</button>}</td>
              </tr>
            ))}
            <tr className="total"><td colSpan={2}>Services {peso(t.services)} · Advances {peso(t.advances)}</td><td className="num" colSpan={2}>Total {peso(t.total)}</td><td colSpan={2}></td></tr>
          </tbody>
        </table>
      )}
      {canBill && (
        <form className="row wrap billing-form" onSubmit={addCharge}>
          <select value={charge.kind} aria-label="Charge" onChange={(e) => {
            const kind = e.target.value as ChargeKind;
            // Duties and taxes are paid for the client, without VAT; VSA's own fees carry VAT.
            setCharge({ ...charge, kind, advance: kind === "duties_taxes", vatable: !["duties_taxes", "arrastre", "wharfage"].includes(kind) });
          }}>
            {CHARGE_KINDS.map((k) => <option key={k} value={k}>{CHARGE_LABEL[k]}</option>)}
          </select>
          <input placeholder="Details (optional)" value={charge.description} onChange={(e) => setCharge({ ...charge, description: e.target.value })} aria-label="Charge details" />
          <input placeholder="Amount ₱" inputMode="decimal" value={charge.amount} onChange={(e) => setCharge({ ...charge, amount: e.target.value })} aria-label="Charge amount" required style={{ width: "9em" }} />
          <label className="check" title={charge.advance ? "Advances paid for the client carry no VAT" : undefined}><input type="checkbox" checked={charge.vatable && !charge.advance} disabled={charge.advance} onChange={(e) => setCharge({ ...charge, vatable: e.target.checked })} /> + VAT</label>
          <label className="check"><input type="checkbox" checked={charge.advance} onChange={(e) => setCharge({ ...charge, advance: e.target.checked, vatable: e.target.checked ? false : charge.vatable })} /> Advance for client</label>
          <button disabled={busy}>Add charge</button>
        </form>
      )}

      <h3>Payments received</h3>
      {payments.length === 0 ? <p className="muted small">No payments yet.</p> : (
        <table className="small">
          <thead><tr><th>Date</th><th className="num">Amount</th><th className="num">Tax withheld</th><th>How</th><th>Reference</th><th>Receipt</th><th></th></tr></thead>
          <tbody>
            {payments.map((p) => (
              <tr key={p.id}>
                <td className="nowrap">{dayLabel(p.paid_on)}</td><td className="num">{money(Number(p.amount))}</td>
                <td className="num">{Number(p.ewt_amount ?? 0) ? money(Number(p.ewt_amount)) : ""}</td>
                <td>{p.method ? METHOD_LABEL[p.method] : ""}</td><td>{p.reference}</td>
                <td>{p.receipt_id ? <span className="badge">{docNo(p.receipt_id)}</span>
                  : canBill && <button type="button" className="link" disabled={busy} onClick={() => issueReceipt(p)}>Issue receipt</button>}</td>
                <td>{canBill && !p.receipt_id && <button type="button" className="link danger-text" onClick={() => removePayment(p)}>Remove</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {canBill && (
        <form className="row wrap billing-form" onSubmit={addPayment}>
          <input type="date" value={payment.paid_on} onChange={(e) => setPayment({ ...payment, paid_on: e.target.value })} aria-label="Date received" {...pickDate} />
          <input placeholder="Amount ₱" inputMode="decimal" value={payment.amount} onChange={(e) => setPayment({ ...payment, amount: e.target.value })} aria-label="Amount received" required style={{ width: "9em" }} />
          <select value={payment.method} onChange={(e) => setPayment({ ...payment, method: e.target.value as PaymentMethod })} aria-label="Payment method">
            {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{METHOD_LABEL[m]}</option>)}
          </select>
          <input placeholder="Withheld ₱ (2307)" inputMode="decimal" value={payment.ewt} onChange={(e) => setPayment({ ...payment, ewt: e.target.value })} aria-label="Tax withheld by the client (BIR Form 2307)" style={{ width: "11em" }} />
          <input placeholder="Check / bank ref. no." value={payment.reference} onChange={(e) => setPayment({ ...payment, reference: e.target.value })} aria-label="Payment reference" />
          <button disabled={busy}>Record payment</button>
        </form>
      )}

      <h3>BIR documents</h3>
      {canBill && (
        <div className="row wrap">
          <button type="button" disabled={busy || uninvoiced.length === 0} onClick={issueInvoice}
            title={uninvoiced.length ? "" : "Every service charge is already on an invoice (advances are not sales and stay off it)."}>
            Issue sales invoice{uninvoiced.length ? ` (${uninvoiced.length} charge${uninvoiced.length === 1 ? "" : "s"})` : ""}
          </button>
          {uninvoiced.length > 0 && <Link className="ghost-link" to={`/jobs/${job.id}/invoice-preview`} target="_blank">Preview (specimen)</Link>}
          {missingSetup(bir, "invoice").length > 0 && <span className="muted small">Before issuing: complete the <Link to="/bir-books">BIR details</Link>.</span>}
        </div>
      )}
      {docs.length === 0 ? <p className="muted small">No sales invoice or collection receipt issued yet.</p> : (
        <table className="small">
          <thead><tr><th>Document</th><th>No.</th><th>Date</th><th className="num">Amount</th><th></th><th></th></tr></thead>
          <tbody>
            {docs.map((d) => (
              <tr key={d.id} className={d.voided ? "voided" : ""}>
                <td>{DOC_TITLE[d.doc_type]}</td><td className="nowrap"><strong>{d.doc_no}</strong>{d.voided && <span className="badge void">VOID</span>}</td>
                <td className="nowrap">{dayLabel(d.issued_on)}</td><td className="num">{amount(d.total)}</td>
                <td><Link to={`/bir/${d.id}`} target="_blank">Print</Link></td>
                <td>{canBill && !d.voided && <button type="button" className="link danger-text" disabled={busy} onClick={() => voidDoc(d)}>Void</button>}
                  {d.voided && <span className="muted small" title={d.void_reason ?? ""}>{d.void_reason}</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {canBill && (
        <form className="row wrap billing-form" onSubmit={saveSoa}>
          <label>SOA no.<input value={soa.soa_no} onChange={(e) => setSoa({ ...soa, soa_no: e.target.value })} style={{ width: "10em" }} /></label>
          <label>Billed on<input type="date" value={soa.billed_on} onChange={(e) => setSoa({ ...soa, billed_on: e.target.value })} {...pickDate} /></label>
          <button className="ghost" disabled={busy}>Save SOA details</button>
          <span className="muted small">Payment is due {termsDays} days after the billed date (client's terms).</span>
        </form>
      )}
    </section>
  );
}
