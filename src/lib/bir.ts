// BIR documents: computer-printed Sales Invoices (VSA's own services) and Collection Receipts
// (payments received). Numbers, locking and voiding are done by the database; this file only
// describes the records and builds the monthly books.
import { money } from "./billing";

export type BirSettings = {
  registered_name: string | null; trade_name: string | null; tin: string | null; branch_code: string; address: string | null;
  vat_registered: boolean; permit_no: string | null; permit_date: string | null;
  invoice_prefix: string; invoice_from: number | null; invoice_to: number | null;
  receipt_prefix: string; receipt_from: number | null; receipt_to: number | null;
};
export type BirLine = { description: string; amount: number; vatable?: boolean; kind?: string };
export type BirDoc = {
  id: number; doc_type: "invoice" | "receipt"; serial_no: number; doc_no: string; job_id: string; payment_id: number | null;
  issued_on: string; issued_at: string; issued_by_name: string | null;
  buyer_name: string; buyer_tin: string | null; buyer_address: string | null; lines: BirLine[];
  vatable_sales: number; vat_amount: number; exempt_sales: number; zero_rated: number; total: number;
  amount_received: number | null; ewt_amount: number; seller: Partial<BirSettings>;
  voided: boolean; void_reason: string | null; voided_at: string | null;
  jobs?: { job_no: string } | null;
};

export const DOC_TITLE = { invoice: "Sales Invoice", receipt: "Collection Receipt" } as const;

/** What is still missing before real documents can be issued (empty = ready). */
export function missingSetup(s: BirSettings | null, type: "invoice" | "receipt"): string[] {
  if (!s) return ["BIR details"];
  const out: string[] = [];
  if (!s.registered_name?.trim()) out.push("registered name");
  if (!s.tin?.trim()) out.push("TIN");
  if (!s.address?.trim()) out.push("registered address");
  if (!s.permit_no?.trim()) out.push("BIR permit / acknowledgement certificate no.");
  if (type === "invoice" && (!s.invoice_from || !s.invoice_to)) out.push("sales invoice number series");
  if (type === "receipt" && (!s.receipt_from || !s.receipt_to)) out.push("collection receipt number series");
  return out;
}

/** 000-123-456 + branch 00000 → "000-123-456-00000". */
export const tinWithBranch = (s: Partial<BirSettings>) => [s.tin?.trim(), s.branch_code?.trim() || "00000"].filter(Boolean).join("-");

export type BookRow = Record<string, string | number | null>;
/** The Sales Book for a month: one row per invoice in number order; a void invoice keeps its line with zero amounts. */
export function salesBook(docs: BirDoc[]): BookRow[] {
  return docs.filter((d) => d.doc_type === "invoice").sort((a, b) => a.serial_no - b.serial_no).map((d) => ({
    Date: d.issued_on, "Invoice no.": d.doc_no, Customer: d.buyer_name, TIN: d.buyer_tin ?? "", Address: d.buyer_address ?? "",
    PN: d.jobs?.job_no ?? "",
    "VATable sales": d.voided ? 0 : Number(d.vatable_sales), "VAT (12%)": d.voided ? 0 : Number(d.vat_amount),
    "VAT-exempt sales": d.voided ? 0 : Number(d.exempt_sales), "Zero-rated": d.voided ? 0 : Number(d.zero_rated),
    Total: d.voided ? 0 : Number(d.total), Status: d.voided ? `VOID: ${d.void_reason ?? ""}` : "",
  }));
}
/** The Collections Book for a month: one row per receipt in number order. */
export function collectionsBook(docs: BirDoc[]): BookRow[] {
  return docs.filter((d) => d.doc_type === "receipt").sort((a, b) => a.serial_no - b.serial_no).map((d) => ({
    Date: d.issued_on, "Receipt no.": d.doc_no, "Received from": d.buyer_name, TIN: d.buyer_tin ?? "", PN: d.jobs?.job_no ?? "",
    "Cash / check received": d.voided ? 0 : Number(d.amount_received ?? 0), "Tax withheld (2307)": d.voided ? 0 : Number(d.ewt_amount),
    "Total settled": d.voided ? 0 : Number(d.total), Status: d.voided ? `VOID: ${d.void_reason ?? ""}` : "",
  }));
}
export type VatSummary = { invoices: number; voided: number; vatable: number; vat: number; exempt: number; zero: number; total: number; ewt: number; collected: number };
/** Totals for the month, for the VAT return (2550Q) and the accountant. */
export function vatSummary(docs: BirDoc[]): VatSummary {
  const live = docs.filter((d) => !d.voided);
  const inv = live.filter((d) => d.doc_type === "invoice"), rec = live.filter((d) => d.doc_type === "receipt");
  const sum = (xs: BirDoc[], f: (d: BirDoc) => number) => Math.round(xs.reduce((s, d) => s + f(d), 0) * 100) / 100;
  return {
    invoices: inv.length, voided: docs.filter((d) => d.voided).length,
    vatable: sum(inv, (d) => Number(d.vatable_sales)), vat: sum(inv, (d) => Number(d.vat_amount)),
    exempt: sum(inv, (d) => Number(d.exempt_sales)), zero: sum(inv, (d) => Number(d.zero_rated)), total: sum(inv, (d) => Number(d.total)),
    ewt: sum(rec, (d) => Number(d.ewt_amount)), collected: sum(rec, (d) => Number(d.amount_received ?? 0)),
  };
}

const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen",
  "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
function words999(n: number): string {
  const h = Math.floor(n / 100), r = n % 100;
  const rest = r < 20 ? ONES[r] : `${TENS[Math.floor(r / 10)]}${r % 10 ? "-" + ONES[r % 10] : ""}`;
  return [h ? `${ONES[h]} Hundred` : "", rest].filter(Boolean).join(" ");
}
/** 12345.6 → "Twelve Thousand Three Hundred Forty-Five Pesos and 60/100", as written on receipts. */
export function pesoWords(amount: number): string {
  const whole = Math.floor(Math.round(amount * 100) / 100);
  const cents = Math.round((amount - whole) * 100);
  const parts: string[] = [];
  const units: [number, string][] = [[1e9, "Billion"], [1e6, "Million"], [1e3, "Thousand"], [1, ""]];
  let left = whole;
  for (const [u, name] of units) {
    const q = Math.floor(left / u);
    if (q) { parts.push(`${words999(q)}${name ? " " + name : ""}`); left -= q * u; }
  }
  return `${parts.join(" ") || "Zero"} Pesos and ${String(cents).padStart(2, "0")}/100`;
}

export const amount = (n: number | null | undefined) => money(Number(n ?? 0));
