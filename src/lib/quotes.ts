// Quotations: lines like billing charges, the same totals, standard terms and validity.
import { totals, type ChargeKind } from "./billing";

export type QuoteLine = { kind: ChargeKind; description: string; amount: number; vatable: boolean; advance: boolean };
export type QuoteStatus = "draft" | "sent" | "accepted" | "declined";
export const QUOTE_STATUS_LABEL: Record<QuoteStatus, string> = { draft: "Draft", sent: "Sent", accepted: "Accepted", declined: "Declined" };
export type Quote = {
  id: number; quote_no: string; client_id: string | null; prospect_name: string | null; prospect_email: string | null;
  service_type: "brokerage" | "forwarding" | "trucking"; cargo: string | null; route: string | null; lines: QuoteLine[];
  valid_until: string | null; terms: string | null; status: QuoteStatus; job_id: string | null; created_at: string;
  clients?: { name: string; email: string | null; address: string | null } | null; jobs?: { job_no: string } | null;
};
export type StandardFee = { id: number; name: string; kind: ChargeKind; amount: number; vatable: boolean; advance: boolean; sort: number };

export const VALID_DAYS = 15;
export const DEFAULT_TERMS = [
  "Brokerage, documentation and trucking fees are subject to 12% VAT where shown.",
  "Duties and taxes are estimates; the amounts assessed by the Bureau of Customs are billed at cost.",
  "Arrastre, wharfage, storage, demurrage and shipping line charges paid for the client are billed at cost, with official receipts.",
  "Rates may change with the shipment's actual details (weight, volume, number of containers, permits needed).",
].join("\n");

/** A line can never be both an advance and carry VAT (the same rule as billing). */
export const cleanLine = (l: QuoteLine): QuoteLine => ({ ...l, amount: Math.round(Number(l.amount) * 100) / 100, vatable: l.vatable && !l.advance });

export const quoteTotals = (lines: QuoteLine[]) => totals(lines.map(cleanLine), []);

export const quoteFor = (q: Pick<Quote, "clients" | "prospect_name">) => q.clients?.name ?? q.prospect_name ?? "";

/** Not accepted or declined, and past its valid-until date. */
export const isExpired = (q: Pick<Quote, "status" | "valid_until">, today: string) =>
  (q.status === "draft" || q.status === "sent") && !!q.valid_until && q.valid_until < today;
