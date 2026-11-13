// Charges, payments and balances. Amounts are in Philippine pesos; VAT is 12% on vatable charges.
export const VAT_RATE = 0.12;

export const CHARGE_KINDS = ["brokerage_fee", "duties_taxes", "arrastre", "wharfage", "storage", "demurrage", "trucking", "documentation", "other"] as const;
export type ChargeKind = (typeof CHARGE_KINDS)[number];
export const CHARGE_LABEL: Record<ChargeKind, string> = {
  brokerage_fee: "Brokerage fee", duties_taxes: "Duties and taxes", arrastre: "Arrastre", wharfage: "Wharfage",
  storage: "Storage", demurrage: "Demurrage", trucking: "Trucking", documentation: "Documentation", other: "Other",
};
export const PAYMENT_METHODS = ["cash", "check", "bank_transfer", "online", "other"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export const METHOD_LABEL: Record<PaymentMethod, string> = { cash: "Cash", check: "Check", bank_transfer: "Bank transfer", online: "Online", other: "Other" };

export type Charge = { id: number; job_id: string; kind: ChargeKind; description: string | null; amount: number; vatable: boolean; advance: boolean; created_at: string };
export type Payment = { id: number; job_id: string; amount: number; paid_on: string; method: PaymentMethod | null; reference: string | null; created_at: string };

const round = (n: number) => Math.round(n * 100) / 100;
export const vatOf = (c: Pick<Charge, "amount" | "vatable">) => (c.vatable ? round(Number(c.amount) * VAT_RATE) : 0);

export type Totals = { services: number; advances: number; vat: number; total: number; paid: number; balance: number };
/** Services (VSA's own fees), advances (paid for the client), VAT, total billed, paid and balance due. */
export function totals(charges: Pick<Charge, "amount" | "vatable" | "advance">[], payments: Pick<Payment, "amount">[]): Totals {
  const services = round(charges.filter((c) => !c.advance).reduce((s, c) => s + Number(c.amount), 0));
  const advances = round(charges.filter((c) => c.advance).reduce((s, c) => s + Number(c.amount), 0));
  const vat = round(charges.reduce((s, c) => s + vatOf(c), 0));
  const total = round(services + advances + vat);
  const paid = round(payments.reduce((s, p) => s + Number(p.amount), 0));
  return { services, advances, vat, total, paid, balance: round(total - paid) };
}

const fmt = new Intl.NumberFormat("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** 12,345.60 */
export const money = (n: number | null | undefined) => (n == null ? "" : fmt.format(n));
/** ₱12,345.60 */
export const peso = (n: number | null | undefined) => (n == null ? "" : "₱" + fmt.format(n));

/** The day payment is due: billed date plus the client's payment terms. */
export function dueDate(billedOn: string | null, termsDays: number | null | undefined): string | null {
  if (!billedOn) return null;
  const d = new Date(Date.UTC(+billedOn.slice(0, 4), +billedOn.slice(5, 7) - 1, +billedOn.slice(8, 10) + (termsDays ?? 30)));
  return d.toISOString().slice(0, 10);
}

export type AgeBucket = "current" | "1-30" | "31-60" | "61-90" | "90+";
export const AGE_LABEL: Record<AgeBucket, string> = { current: "Not yet due", "1-30": "1–30 days overdue", "31-60": "31–60 days", "61-90": "61–90 days", "90+": "Over 90 days" };
/** How late an unpaid balance is, from its due date. */
export function ageOf(due: string | null, today: string): AgeBucket {
  if (!due || due >= today) return "current";
  const days = Math.round((Date.parse(today) - Date.parse(due)) / 86400000);
  return days <= 30 ? "1-30" : days <= 60 ? "31-60" : days <= 90 ? "61-90" : "90+";
}
