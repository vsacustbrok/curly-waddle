// Owner's dashboard: the month at a glance and the last 12 months, worked out from shipments,
// charges and payments. Pure functions, so the figures can be tested.

/** The last `n` months up to and including today's, as YYYY-MM, oldest first. */
export function lastMonths(today: string, n = 12): string[] {
  const y = +today.slice(0, 4), m = +today.slice(5, 7);
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 1 - (n - 1 - i), 1));
    return d.toISOString().slice(0, 7);
  });
}

/** "Nov" or "Nov 2026" for a YYYY-MM month. */
export function monthLabel(ym: string, withYear = false): string {
  return new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7) - 1, 1))
    .toLocaleDateString("en-US", { month: "short", ...(withYear ? { year: "numeric" } : {}), timeZone: "UTC" });
}

export type MonthMoney = { month: string; billed: number; collected: number };
/**
 * Billed = everything on the shipments billed that month (services, VAT and advances), by billed date.
 * Collected = payments received that month, tax withheld by the client (2307) included, by payment date.
 */
export function billedCollected(
  billed: { billed_on: string | null; total: number }[],
  payments: { paid_on: string; amount: number; ewt_amount?: number | null }[],
  months: string[],
): MonthMoney[] {
  const r2 = (n: number) => Math.round(n * 100) / 100;
  return months.map((month) => ({
    month,
    billed: r2(billed.filter((b) => b.billed_on?.startsWith(month)).reduce((s, b) => s + b.total, 0)),
    collected: r2(payments.filter((p) => p.paid_on.startsWith(month)).reduce((s, p) => s + Number(p.amount) + Number(p.ewt_amount ?? 0), 0)),
  }));
}

/** Shipments per step; "released" counts as Released / Delivered, as on the board. */
export function countBySteps(statuses: string[], steps: string[]): { step: string; count: number }[] {
  return steps.map((step) => ({ step, count: statuses.filter((s) => (s === "released" ? "delivered" : s) === step).length }));
}

/** A round axis top a little above the largest value: 1, 2, 2.5 or 5 × a power of ten. */
export function niceMax(v: number): number {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 2.5, 5, 10].map((k) => k * p).find((x) => x >= v)!;
}

/** ₱1.2M, ₱350K, ₱900 for axis labels and bar ends. */
export function shortPeso(n: number): string {
  const a = Math.abs(n);
  const s = a >= 1e6 ? `${+(a / 1e6).toFixed(a >= 1e7 ? 0 : 1)}M` : a >= 1e3 ? `${+(a / 1e3).toFixed(a >= 1e4 ? 0 : 1)}K` : `${Math.round(a)}`;
  return (n < 0 ? "−₱" : "₱") + s;
}
