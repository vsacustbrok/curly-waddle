// Statement of account for one shipment, laid out for printing or saving as PDF.
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { dayLabel, type Job } from "../lib/types";
import { CHARGE_LABEL, METHOD_LABEL, dueDate, money, peso, totals, vatOf, type Charge, type Payment } from "../lib/billing";

const LOGO = "/logo.webp";

export default function Soa() {
  const { id } = useParams();
  const [job, setJob] = useState<Job | null>(null);
  const [charges, setCharges] = useState<Charge[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([
      supabase.from("jobs").select("*, clients(name, address, tin, payment_terms_days)").eq("id", id!).maybeSingle(),
      supabase.from("charges").select("*").eq("job_id", id!).order("id"),
      supabase.from("payments").select("*").eq("job_id", id!).order("paid_on"),
    ]).then(([j, c, p]) => {
      setError(j.error?.message ?? c.error?.message ?? p.error?.message ?? (j.data ? "" : "Shipment not found."));
      setJob(j.data as Job | null);
      setCharges((c.data as Charge[]) ?? []);
      setPayments((p.data as Payment[]) ?? []);
    });
  }, [id]);

  if (error) return <p className="error">{error}</p>;
  if (!job) return <p className="muted">Loading…</p>;
  const t = totals(charges, payments);
  const due = dueDate(job.billed_on, job.clients?.payment_terms_days);
  const services = charges.filter((c) => !c.advance);
  const advances = charges.filter((c) => c.advance);
  const lines = (list: Charge[]) => list.map((c) => (
    <tr key={c.id}>
      <td>{CHARGE_LABEL[c.kind]}{c.description ? ` — ${c.description}` : ""}</td>
      <td className="num">{money(Number(c.amount))}</td><td className="num">{c.vatable ? money(vatOf(c)) : ""}</td>
      <td className="num">{money(Number(c.amount) + vatOf(c))}</td>
    </tr>
  ));

  return (
    <>
      <div className="row no-print">
        <Link to={`/jobs/${job.id}`}>‹ Back to {job.job_no}</Link>
        <button type="button" onClick={() => window.print()}>Print or save as PDF</button>
      </div>
      <article className="soa card">
        <header className="soa-head">
          <img src={LOGO} alt="" onError={(e) => { e.currentTarget.style.display = "none"; }} />
          <div>
            <h1>VSA Customs Brokerage</h1>
            <p className="muted">Statement of account</p>
          </div>
          <dl className="soa-meta">
            <div><dt>SOA no.</dt><dd>{job.soa_no ?? "—"}</dd></div>
            <div><dt>Date</dt><dd>{dayLabel(job.billed_on) ?? dayLabel(new Date().toISOString().slice(0, 10))}</dd></div>
            <div><dt>Due</dt><dd>{dayLabel(due) ?? "—"}</dd></div>
          </dl>
        </header>

        <section className="soa-parties">
          <div>
            <h3>Bill to</h3>
            <strong>{job.clients?.name}</strong>
            {job.clients?.address && <div className="pre">{job.clients.address}</div>}
            {job.clients?.tin && <div>TIN {job.clients.tin}</div>}
          </div>
          <div>
            <h3>Shipment</h3>
            <div>PN <strong>{job.job_no}</strong>{job.client_ref_no ? ` · Your ref. ${job.client_ref_no}` : ""}</div>
            {job.bl_awb_no && <div>BL / AWB {job.bl_awb_no}</div>}
            {!!job.containers?.length && <div>Container{job.containers.length > 1 ? "s" : ""} {job.containers.join(", ")}</div>}
            {job.entry_no && <div>Entry no. {job.entry_no}</div>}
            {job.item_description && <div>{job.item_description}</div>}
          </div>
        </section>

        <table className="soa-lines">
          <thead><tr><th>Description</th><th className="num">Amount</th><th className="num">VAT 12%</th><th className="num">Total</th></tr></thead>
          <tbody>
            {services.length > 0 && <tr className="soa-group"><td colSpan={4}>Services</td></tr>}
            {lines(services)}
            {advances.length > 0 && <tr className="soa-group"><td colSpan={4}>Advances paid for the client</td></tr>}
            {lines(advances)}
          </tbody>
          <tfoot>
            <tr><td colSpan={3}>Total amount</td><td className="num">{peso(t.total)}</td></tr>
            {payments.map((p) => (
              <tr key={p.id} className="muted"><td colSpan={3}>Less payment {dayLabel(p.paid_on)}{p.method ? `, ${METHOD_LABEL[p.method].toLowerCase()}` : ""}{p.reference ? ` (${p.reference})` : ""}</td><td className="num">−{money(Number(p.amount))}</td></tr>
            ))}
            <tr className="soa-balance"><td colSpan={3}>Balance due</td><td className="num">{peso(t.balance)}</td></tr>
          </tfoot>
        </table>
        <p className="small muted">Please pay on or before the due date. For questions about this statement, contact VSA Customs Brokerage.</p>
      </article>
    </>
  );
}
