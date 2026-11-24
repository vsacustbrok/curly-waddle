// Cash advances: money given to staff, the receipts that liquidate it, cash returned, and what is left.

export const COST_KINDS = ["duties_taxes", "arrastre", "wharfage", "storage", "demurrage", "trucking", "documentation", "other"] as const;
export type CostKind = (typeof COST_KINDS)[number];
export const COST_LABEL: Record<CostKind, string> = {
  duties_taxes: "Duties and taxes", arrastre: "Arrastre", wharfage: "Wharfage", storage: "Storage", demurrage: "Demurrage",
  trucking: "Trucking", documentation: "Documentation / permits", other: "Other (e.g. shipping line fees)",
};

export type Advance = {
  id: number; given_on: string; person_name: string; profile_id: string | null; amount: number; purpose: string | null;
  job_id: string | null; status: "open" | "closed"; closed_at: string | null; jobs?: { job_no: string } | null;
};
export type AdvanceLine = {
  id: number; advance_id: number; kind: "spent" | "returned" | "reimbursed"; job_id: string | null; cost_kind: CostKind | null; description: string | null;
  receipt_no: string | null; spent_on: string; amount: number; billable: boolean; photo_path: string | null; charge_id: number | null;
  created_by: string | null; jobs?: { job_no: string } | null;
};

export type AdvanceSums = { given: number; spent: number; returned: number; reimbursed: number; balance: number; unbilled: number; needsPn: number };
const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * balance > 0: the person still holds cash to spend or return; < 0: they spent more than given and the
 * office owes them (paying them back is a "reimbursed" line, which adds to what they were given). unbilled: billable spending on a shipment not yet on the client's billing;
 * needsPn: billable spending with no shipment chosen yet.
 */
export function sumsOf(a: Pick<Advance, "amount">, lines: Pick<AdvanceLine, "kind" | "amount" | "billable" | "job_id" | "charge_id">[]): AdvanceSums {
  const spent = r2(lines.filter((l) => l.kind === "spent").reduce((s, l) => s + Number(l.amount), 0));
  const returned = r2(lines.filter((l) => l.kind === "returned").reduce((s, l) => s + Number(l.amount), 0));
  const reimbursed = r2(lines.filter((l) => l.kind === "reimbursed").reduce((s, l) => s + Number(l.amount), 0));
  const billable = lines.filter((l) => l.kind === "spent" && l.billable && !l.charge_id);
  return {
    given: Number(a.amount), spent, returned, reimbursed, balance: r2(Number(a.amount) + reimbursed - spent - returned),
    unbilled: r2(billable.filter((l) => l.job_id).reduce((s, l) => s + Number(l.amount), 0)),
    needsPn: billable.filter((l) => !l.job_id).length,
  };
}

/** Days an advance has been open, for "liquidate within N days" reminders. */
export const daysOpen = (givenOn: string, today: string) =>
  Math.round((Date.parse(today) - Date.parse(givenOn)) / 86400000);
export const LIQUIDATE_WITHIN_DAYS = 7;
