// Turnaround: how many days each stretch of a shipment took, and the typical (median) days per client,
// processor and shipping line. Dates: arrival = ETA, lodged = entry filed date, released = release date
// (or the first move to Released / Delivered), billed = billed date (or the first move to Billed).

export const STRETCHES = ["arrivalToLodged", "lodgedToReleased", "releasedToBilled", "lodgedToBilled"] as const;
export type Stretch = (typeof STRETCHES)[number];
export const STRETCH_LABEL: Record<Stretch, string> = {
  arrivalToLodged: "Arrival → lodged", lodgedToReleased: "Lodged → released", releasedToBilled: "Released → billed", lodgedToBilled: "Lodged → billed (whole job)",
};

export type TJob = {
  id: string; job_no: string; eta: string | null; entry_filed_date: string | null; released_at: string | null; billed_on: string | null;
};
export type THistory = { job_id: string; to_status: string; changed_at: string };
export type JobDays = Partial<Record<Stretch, number>>;

const day = (d: string | null | undefined) => (d ? d.slice(0, 10) : null);
const diff = (from: string | null, to: string | null) => {
  if (!from || !to) return undefined;
  const n = Math.round((Date.parse(to) - Date.parse(from)) / 86400000);
  return n >= 0 && n <= 365 ? n : undefined;   // negative or over a year = a date typed wrong; left out
};

/** The days each stretch took for one shipment; a stretch with a missing or impossible date is left out. */
export function daysOf(j: TJob, history: THistory[]): JobDays {
  const first = (steps: string[]) => history.filter((h) => h.job_id === j.id && steps.includes(h.to_status)).map((h) => day(h.changed_at)!).sort()[0] ?? null;
  const lodged = day(j.entry_filed_date);
  const released = day(j.released_at) ?? first(["released", "delivered"]);
  const billed = day(j.billed_on) ?? first(["billed"]);
  const out: JobDays = {};
  const put = (k: Stretch, v: number | undefined) => { if (v !== undefined) out[k] = v; };
  put("arrivalToLodged", diff(day(j.eta), lodged));
  put("lodgedToReleased", diff(lodged, released));
  put("releasedToBilled", diff(released, billed));
  put("lodgedToBilled", diff(lodged, billed));
  return out;
}

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export type GroupRow = { name: string; shipments: number } & Record<Stretch, { median: number | null; n: number }>;
/** Median days per stretch for each group (client, processor, line), busiest groups first. */
export function byGroup(items: { group: string; days: JobDays }[]): GroupRow[] {
  const groups = new Map<string, JobDays[]>();
  for (const it of items) groups.set(it.group, [...(groups.get(it.group) ?? []), it.days]);
  return [...groups.entries()].map(([name, list]) => {
    const row = { name, shipments: list.length } as GroupRow;
    for (const k of STRETCHES) {
      const xs = list.map((d) => d[k]).filter((v): v is number => v !== undefined);
      row[k] = { median: median(xs), n: xs.length };
    }
    return row;
  }).sort((a, b) => b.shipments - a.shipments || a.name.localeCompare(b.name));
}
