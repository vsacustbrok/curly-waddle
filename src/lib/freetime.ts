// Demurrage and storage watch: each container's last free day and the pesos running after it.
// The last free day is the date typed on the shipment when there is one; otherwise it is estimated
// from the ETA (taken as the discharge day, day 1 of free time) and the free days of the shipping
// line (demurrage) or the port (storage). Amounts = days past free time × containers × daily rate.

export type FreeKind = "demurrage" | "storage";
export type FreeRule = { id?: number; kind: FreeKind; name: string; free_days: number; rate_20: number | null; rate_40: number | null; note?: string | null };
export type FreeJob = {
  status: string; eta: string | null; carrier: string | null; container_size: string | null; containers: string[] | null;
  storage_free_until: string | null; demurrage_free_until: string | null;
};
export type FreeLine = {
  kind: FreeKind; until: string; estimated: boolean; rule: string; daysOver: number;
  perDay: number | null;    // ₱ per container per day; null = rate not set
  containers: number; amount: number | null; in3Days: number | null;
};

/** "MAERSK LINES" and "Maersk Line" are the same line: compare names without company words. */
export function lineKey(name: string | null | undefined): string {
  return (name ?? "").toUpperCase().replace(/[^A-Z0-9 ]/g, " ")
    .split(/\s+/).filter((w) => w && !["LINE", "LINES", "SHIPPING", "CO", "LTD", "INC", "CORP", "CORPORATION", "CONTAINER", "LINER"].includes(w))
    .join(" ");
}

/** The rule for a shipping line (or the port), else the "Default" row of that kind. */
export function ruleFor(rules: FreeRule[], kind: FreeKind, carrier: string | null): FreeRule | null {
  const mine = rules.filter((r) => r.kind === kind);
  const key = lineKey(carrier);
  const own = key ? mine.find((r) => lineKey(r.name) !== "DEFAULT" && (lineKey(r.name) === key || key.startsWith(lineKey(r.name) + " ") || lineKey(r.name).startsWith(key + " "))) : undefined;
  return own ?? mine.find((r) => lineKey(r.name) === "DEFAULT") ?? null;
}

const utc = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
export const daysBetween = (from: string, to: string) => Math.round((utc(to) - utc(from)) / 86400000);
export function addDays(d: string, n: number): string {
  return new Date(utc(d) + n * 86400000).toISOString().slice(0, 10);
}

/** 20 when the size says so; anything else (40, 40HC, 45, unknown) is charged as 40-ft. */
export const isTwenty = (size: string | null) => /(^|\D)20(\D|$)/.test(size ?? "");

const AT_PORT = ["pre_arrival", "lodged", "assessed", "paid", "gatepass", "tabs"];

/** Storage and demurrage for a shipment still at the port. Air and loose cargo (no containers) have none. */
export function freeTime(j: FreeJob, rules: FreeRule[], today: string): FreeLine[] {
  const n = (j.containers ?? []).filter(Boolean).length;
  if (!n || !AT_PORT.includes(j.status)) return [];
  const out: FreeLine[] = [];
  for (const kind of ["storage", "demurrage"] as FreeKind[]) {
    const typed = (kind === "storage" ? j.storage_free_until : j.demurrage_free_until)?.slice(0, 10) || null;
    const rule = ruleFor(rules, kind, kind === "demurrage" ? j.carrier : null);
    const until = typed ?? (j.eta && rule ? addDays(j.eta.slice(0, 10), rule.free_days - 1) : null);
    if (!until) continue;
    const rate = rule ? (isTwenty(j.container_size) ? rule.rate_20 : rule.rate_40) : null;
    const perDay = rate == null ? null : Number(rate);
    const over = Math.max(0, daysBetween(until, today));
    const over3 = Math.max(0, daysBetween(until, addDays(today, 3)));
    out.push({
      kind, until, estimated: !typed, rule: rule?.name ?? "", daysOver: over, perDay, containers: n,
      amount: perDay == null ? null : over * perDay * n, in3Days: perDay == null ? null : over3 * perDay * n,
    });
  }
  return out;
}

/** Pesos running now and in 3 days for one shipment (unknown rates count as zero; `missingRate` says so). */
export function moneyAtRisk(lines: FreeLine[]): { now: number; in3Days: number; missingRate: boolean } {
  return {
    now: lines.reduce((a, l) => a + (l.amount ?? 0), 0),
    in3Days: lines.reduce((a, l) => a + (l.in3Days ?? 0), 0),
    missingRate: lines.some((l) => l.perDay == null),
  };
}
