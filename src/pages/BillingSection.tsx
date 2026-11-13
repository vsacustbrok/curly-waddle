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

const blankCharge = { kind: "brokerage_fee" as ChargeKind, description: "", amount: "", vatable: true, advance: false };
const blankPayment = { amount: "", paid_on: "", method: "bank_transfer" as PaymentMethod, reference: "" };

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

  const load = useCallback(async () => {
    const [c, p] = await Promise.all([
      supabase.from("charges").select("*").eq("job_id", job.id).order("id"),
      supabase.from("payments").select("*").eq("job_id", job.id).order("paid_on"),
    ]);
    setError(c.error?.message ?? p.error?.message ?? "");
    setCharges((c.data as Charge[]) ?? []);
    setPayments((p.data as Payment[]) ?? []);
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
    if (await run(() => supabase.from("charges").insert({ job_id: job.id, kind: charge.kind, description: charge.description.trim() || null, amount, vatable: charge.vatable, advance: charge.advance }))) {
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
    if (!(amount > 0)) { setError("Enter the amount received as a number above zero."); return; }
    if (await run(() => supabase.from("payments").insert({ job_id: job.id, amount, paid_on: payment.paid_on || today(), method: payment.method, reference: payment.reference.trim() || null }))) {
      setPayment({ ...blankPayment, paid_on: today() }); load();
    }
  }
  async function removePayment(p: Payment) {
    if (!confirm(`Remove the payment of ${peso(Number(p.amount))} on ${dayLabel(p.paid_on)}?`)) return;
    if (await run(() => supabase.from("payments").delete().eq("id", p.id))) load();
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
        {charges.length > 0 && <Link className="button-like" to={`/jobs/${job.id}/soa`}>Statement of account</Link>}
      </div>
      {error && <p className="error">{error}</p>}

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
                <td className="muted">{c.advance ? "Advance for client" : ""}</td>
                <td>{canBill && <button type="button" className="link danger-text" onClick={() => removeCharge(c)}>Remove</button>}</td>
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
          <label className="check"><input type="checkbox" checked={charge.vatable} onChange={(e) => setCharge({ ...charge, vatable: e.target.checked })} /> + VAT</label>
          <label className="check"><input type="checkbox" checked={charge.advance} onChange={(e) => setCharge({ ...charge, advance: e.target.checked })} /> Advance for client</label>
          <button disabled={busy}>Add charge</button>
        </form>
      )}

      <h3>Payments received</h3>
      {payments.length === 0 ? <p className="muted small">No payments yet.</p> : (
        <table className="small">
          <thead><tr><th>Date</th><th className="num">Amount</th><th>How</th><th>Reference</th><th></th></tr></thead>
          <tbody>
            {payments.map((p) => (
              <tr key={p.id}>
                <td className="nowrap">{dayLabel(p.paid_on)}</td><td className="num">{money(Number(p.amount))}</td>
                <td>{p.method ? METHOD_LABEL[p.method] : ""}</td><td>{p.reference}</td>
                <td>{canBill && <button type="button" className="link danger-text" onClick={() => removePayment(p)}>Remove</button>}</td>
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
          <input placeholder="OR / check / bank ref. no." value={payment.reference} onChange={(e) => setPayment({ ...payment, reference: e.target.value })} aria-label="Payment reference" />
          <button disabled={busy}>Record payment</button>
        </form>
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
