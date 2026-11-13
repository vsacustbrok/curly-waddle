// Deadlines the office must not miss, worked out from each shipment's dates and step.
// Overdue = the date has passed; today; soon = within the next few days.
import { STATUSES, type Job, type JobStatus } from "./types";

export type AlertKind = "eta" | "cro" | "storage" | "demurrage" | "tabs" | "empty";
export type AlertLevel = "overdue" | "today" | "soon";
export type Alert = { kind: AlertKind; level: AlertLevel; due: string; label: string; days: number };

export const ALERT_KIND_LABEL: Record<AlertKind, string> = {
  eta: "Arrived, not lodged", cro: "CRO validity", storage: "Storage free time", demurrage: "Demurrage free time",
  tabs: "TABS appointment", empty: "Empty return",
};
/** How many days ahead counts as "soon". */
export const SOON_DAYS = 3;

const p2 = (x: number) => String(x).padStart(2, "0");
const ymd = (d: Date) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
/** Today in the viewer's own time zone (the office: Manila), as YYYY-MM-DD. */
export const localToday = () => ymd(new Date());
const dayCount = (from: string, to: string) =>
  Math.round((Date.UTC(+to.slice(0, 4), +to.slice(5, 7) - 1, +to.slice(8, 10)) - Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8, 10))) / 86400000);
const before = (s: JobStatus, than: JobStatus) => STATUSES.indexOf(s === "released" ? "delivered" : s) < STATUSES.indexOf(than);

type AlertJob = Pick<Job, "status" | "eta" | "cro_valid_until" | "tabs_at" | "empty_return_date"> &
  Partial<Pick<Job, "storage_free_until" | "demurrage_free_until" | "empty_return_due">>;

/** The open deadlines of one shipment, most urgent first. Billed shipments have none. */
export function alertsFor(j: AlertJob, today = localToday(), soonDays = SOON_DAYS): Alert[] {
  if (j.status === "billed") return [];
  const out: Alert[] = [];
  const add = (kind: AlertKind, due: string | null | undefined, describe: (days: number) => string) => {
    if (!due) return;
    const days = dayCount(today, due.slice(0, 10));
    if (days > soonDays) return;
    out.push({ kind, due: due.slice(0, 10), days, level: days < 0 ? "overdue" : days === 0 ? "today" : "soon", label: describe(days) });
  };
  const when = (days: number, past: string, now: string, ahead: string) =>
    days < 0 ? `${past} ${-days} day${days === -1 ? "" : "s"} ago` : days === 0 ? now : `${ahead} in ${days} day${days === 1 ? "" : "s"}`;

  // Vessel has arrived (or is about to) and the entry is not lodged yet.
  if (j.status === "pre_arrival") add("eta", j.eta, (d) => when(d, "Arrived", "Arrives today", "Arrives") + ", not lodged");
  // Before pull-out: CRO, storage and container free time all run against the shipment.
  if (before(j.status, "delivered")) {
    add("cro", j.cro_valid_until, (d) => when(d, "CRO expired", "CRO expires today", "CRO expires"));
    add("storage", j.storage_free_until, (d) => when(d, "Storage charges since", "Last free storage day", "Storage free time ends"));
    add("demurrage", j.demurrage_free_until, (d) => when(d, "Demurrage since", "Last free container day", "Demurrage starts"));
  }
  // An appointment booked but the container not out yet.
  if (before(j.status, "delivered") && j.tabs_at) {
    const at = new Date(j.tabs_at);
    const time = at.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    add("tabs", ymd(at), (d) => d < 0 ? `TABS appointment missed (${-d} day${d === -1 ? "" : "s"} ago)` : d === 0 ? `TABS today ${time}` : `TABS in ${d} day${d === 1 ? "" : "s"}, ${time}`);
  }
  // Delivered: the empty container must go back before the line's deadline.
  if (!before(j.status, "delivered") && !j.empty_return_date) {
    add("empty", j.empty_return_due ?? j.demurrage_free_until, (d) =>
      d < 0 ? `Empty return overdue by ${-d} day${d === -1 ? "" : "s"}` : d === 0 ? "Return the empty today" : `Empty return due in ${d} day${d === 1 ? "" : "s"}`);
  }
  return out.sort((a, b) => a.days - b.days);
}

export const LEVEL_LABEL: Record<AlertLevel, string> = { overdue: "Overdue", today: "Due today", soon: `Next ${SOON_DAYS} days` };
