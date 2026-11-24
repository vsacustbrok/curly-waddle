// Rider daily itinerary: the riders, one log per rider per day, and the trips in it.

export type Rider = { id: number; name: string; vehicle: string | null; plate_no: string | null; profile_id: string | null; active: boolean };

export const PURPOSES = ["pickup", "deliver", "submit", "payment", "other"] as const;
export type Purpose = (typeof PURPOSES)[number];
export const PURPOSE_LABEL: Record<Purpose, string> = {
  pickup: "Pick up documents", deliver: "Deliver documents", submit: "Submit / file", payment: "Payment", other: "Other errand",
};

export const TRIP_STATUSES = ["pending", "picked_up", "delivered", "failed", "rescheduled"] as const;
export type TripStatus = (typeof TRIP_STATUSES)[number];
export const TRIP_STATUS_LABEL: Record<TripStatus, string> = {
  pending: "Pending", picked_up: "Picked up", delivered: "Delivered / done", failed: "Not done", rescheduled: "Rescheduled",
};

export type Trip = {
  id?: number; log_id?: number; seq: number; purpose: Purpose; from_place: string | null; to_place: string | null;
  shipping_line: string | null; contact: string | null; details: string | null; job_no: string | null; job_id?: string | null;
  time_out: string | null; time_in: string | null; status: TripStatus;
};

export type RiderLog = {
  id: number; log_date: string; rider_id: number; vehicle: string | null; odo_start: number | null; odo_end: number | null;
  gas: number; food: number; other_amount: number; misc_details: string | null; remarks: string | null;
  riders?: { name: string } | null; rider_trips?: Trip[];
};

/** Shipping lines and agents riders usually go to; typing any other name is allowed. */
export const SHIPPING_LINES = [
  "Maersk", "MSC", "CMA CGM", "COSCO", "Evergreen", "Hapag-Lloyd", "ONE (Ocean Network Express)", "OOCL", "Yang Ming", "ZIM",
  "HMM", "Wan Hai", "SITC", "APL", "SM Line", "KMTC", "TS Lines", "PIL", "RCL", "Sinotrans", "CNC Line", "Interasia",
];

export const blankTrip = (seq: number): Trip => ({
  seq, purpose: "pickup", from_place: "", to_place: "", shipping_line: "", contact: "", details: "", job_no: "",
  time_out: "", time_in: "", status: "pending",
});

const num = (v: unknown) => (v == null || v === "" ? 0 : Number(v) || 0);
export const expensesOf = (l: { gas: unknown; food: unknown; other_amount: unknown }) => num(l.gas) + num(l.food) + num(l.other_amount);
/** Kilometres run: odometer end minus start, when both are filled and make sense. */
export function distanceOf(l: { odo_start: unknown; odo_end: unknown }): number {
  if (l.odo_start == null || l.odo_start === "" || l.odo_end == null || l.odo_end === "") return 0;
  const d = num(l.odo_end) - num(l.odo_start);
  return d > 0 ? Math.round(d * 10) / 10 : 0;
}
/** "14:05:00" from the database as "14:05" for a time box. */
export const hhmm = (t: string | null | undefined) => (t ? t.slice(0, 5) : "");
/** A rider may fill in today's or yesterday's log; older ones are for the office. */
export function riderDayOpen(date: string, today: string): boolean {
  const y = new Date(today + "T00:00:00"); y.setDate(y.getDate() - 1);
  const p = (x: number) => String(x).padStart(2, "0");
  const yesterday = `${y.getFullYear()}-${p(y.getMonth() + 1)}-${p(y.getDate())}`;
  return date === today || date === yesterday;
}

// ---------- Photos (receipts, signed receiving copies) ----------
export const PHOTO_KINDS = ["receipt", "proof", "other"] as const;
export type PhotoKind = (typeof PHOTO_KINDS)[number];
export const PHOTO_KIND_LABEL: Record<PhotoKind, string> = { receipt: "Receipt (gas, toll, parking…)", proof: "Signed receiving copy", other: "Other photo" };
export type RiderPhoto = {
  id: number; log_id: number; trip_id: number | null; kind: PhotoKind; amount: number | null; note: string | null;
  file_path: string; size_bytes: number | null; uploaded_at: string;
};
/** Where a photo is stored: <rider id>/<log id>/<time>-<random>.jpg (the database checks the folders). */
export const photoPath = (riderId: number, logId: number, now = Date.now(), rand = Math.random().toString(36).slice(2, 8)) =>
  `${riderId}/${logId}/${now}-${rand}.jpg`;

/** Errands that are still open (not done, not "not done"). */
export const OPEN_TRIP_STATUSES: TripStatus[] = ["pending", "picked_up", "rescheduled"];
export const isOpenTrip = (s: TripStatus) => OPEN_TRIP_STATUSES.includes(s);
