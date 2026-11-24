// Rider daily itinerary: each rider's trips for the day (document pick-ups and deliveries, from and to
// which company or shipping line), odometer and expenses, with reports for the office.
// Riders fill in their own log on a phone; office staff can enter or correct any rider's log.
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { fetchAll, supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { dayLabel, type Profile } from "../lib/types";
import { money, peso } from "../lib/billing";
import {
  PHOTO_KINDS, PHOTO_KIND_LABEL, PURPOSES, PURPOSE_LABEL, SHIPPING_LINES, TRIP_STATUSES, TRIP_STATUS_LABEL, blankTrip, distanceOf, expensesOf,
  hhmm, photoPath, riderDayOpen, type PhotoKind, type Purpose, type Rider, type RiderLog, type RiderPhoto, type Trip, type TripStatus,
} from "../lib/riders";
import { today } from "./JobFields";
import { shrinkPhoto } from "../lib/photo";

type Tab = "log" | "reports" | "riders";
const text = (v: string | null | undefined) => (v ?? "").trim() || null;
const numOrNull = (v: string) => (v.trim() === "" ? null : Number(v.replace(/,/g, "")));
const amount = (v: string) => Number(v.replace(/,/g, "")) || 0;

export default function Riders() {
  const { profile } = useAuth();
  const isRider = profile?.role === "rider";
  const [tab, setTab] = useState<Tab>("log");
  const [riders, setRiders] = useState<Rider[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");

  const loadRiders = useCallback(async () => {
    const { data, error } = await supabase.from("riders").select("*").order("name");
    setError(error?.message ?? "");
    setRiders((data as Rider[]) ?? []);
    setLoaded(true);
  }, []);
  useEffect(() => { loadRiders(); }, [loadRiders]);

  const mine = isRider ? riders.find((r) => r.profile_id === profile?.id) ?? null : null;
  if (!profile) return null;

  return (
    <>
      <h1>Rider daily itinerary</h1>
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === "log"} className={tab === "log" ? "on" : ""} onClick={() => setTab("log")}>Daily log</button>
        <button role="tab" aria-selected={tab === "reports"} className={tab === "reports" ? "on" : ""} onClick={() => setTab("reports")}>Reports</button>
        {!isRider && <button role="tab" aria-selected={tab === "riders"} className={tab === "riders" ? "on" : ""} onClick={() => setTab("riders")}>Riders</button>}
      </div>
      {error && <p className="error">{error}</p>}
      {!loaded ? <p className="muted">Loading…</p>
        : isRider && !mine ? (
          <section className="card"><p>Your login is not linked to a rider yet. Please ask the office to link it in Riders.</p></section>
        ) : tab === "log" ? <DailyLog riders={riders} mine={mine} isRider={isRider} reloadRiders={loadRiders} />
        : tab === "reports" ? <RiderReports riders={riders} mine={mine} />
        : <RiderData riders={riders} reload={loadRiders} />}
    </>
  );
}

// ---------- Daily log ----------

type LogForm = {
  id: number | null; vehicle: string; odo_start: string; odo_end: string; gas: string; food: string; other_amount: string;
  misc_details: string; remarks: string; trips: Trip[];
};
const blankForm = (vehicle = ""): LogForm => ({
  id: null, vehicle, odo_start: "", odo_end: "", gas: "", food: "", other_amount: "", misc_details: "", remarks: "", trips: [blankTrip(1)],
});
const vehicleOf = (r: Rider | undefined | null) => [r?.vehicle, r?.plate_no].filter(Boolean).join(" / ");
const emptyTrip = (t: Trip) => !text(t.from_place) && !text(t.to_place) && !text(t.details) && !text(t.shipping_line) && !text(t.job_no) && !text(t.contact);

function DailyLog({ riders, mine, isRider, reloadRiders }: { riders: Rider[]; mine: Rider | null; isRider: boolean; reloadRiders: () => Promise<void> }) {
  const active = riders.filter((r) => r.active);
  const [date, setDate] = useState(today());
  const [riderId, setRiderId] = useState<number | null>(mine?.id ?? active[0]?.id ?? null);
  const [form, setForm] = useState<LogForm>(blankForm());
  const [removed, setRemoved] = useState<number[]>([]);
  const [dayLogs, setDayLogs] = useState<RiderLog[]>([]);
  const [places, setPlaces] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);

  const rider = riders.find((r) => r.id === riderId);
  const locked = isRider && !riderDayOpen(date, today());

  const loadLog = useCallback(async () => {
    if (!riderId) { setForm(blankForm()); return; }
    setLoading(true); setRemoved([]);
    const { data, error } = await supabase.from("rider_logs").select("*, rider_trips(*)").eq("rider_id", riderId).eq("log_date", date).maybeSingle();
    setLoading(false);
    if (error) { setError(error.message); return; }
    const l = data as RiderLog | null;
    if (!l) { setForm(blankForm(vehicleOf(riders.find((r) => r.id === riderId)))); return; }
    const s = (v: number | null) => (v == null ? "" : String(v));
    const m = (v: number) => (Number(v) ? String(Number(v)) : "");
    const trips = [...(l.rider_trips ?? [])].sort((a, b) => a.seq - b.seq || (a.id ?? 0) - (b.id ?? 0))
      .map((t) => ({ ...t, time_out: hhmm(t.time_out), time_in: hhmm(t.time_in) }));
    setForm({
      id: l.id, vehicle: l.vehicle ?? "", odo_start: s(l.odo_start), odo_end: s(l.odo_end), gas: m(l.gas), food: m(l.food), other_amount: m(l.other_amount),
      misc_details: l.misc_details ?? "", remarks: l.remarks ?? "", trips: trips.length ? trips : [blankTrip(1)],
    });
  }, [riderId, date, riders]);
  const loadDay = useCallback(async () => {
    const { data } = await supabase.from("rider_logs").select("*, riders(name), rider_trips(*)").eq("log_date", date).order("id");
    setDayLogs((data as RiderLog[]) ?? []);
  }, [date]);
  useEffect(() => { setSaved(""); setError(""); loadLog(); }, [loadLog]);
  useEffect(() => { loadDay(); }, [loadDay]);
  // Company and place names typed before, offered as suggestions.
  useEffect(() => {
    supabase.from("rider_trips").select("from_place, to_place").order("id", { ascending: false }).limit(400).then(({ data }) => {
      const all = (data ?? []).flatMap((t) => [t.from_place as string | null, t.to_place as string | null]).filter(Boolean) as string[];
      setPlaces([...new Set(["VSA Customs Brokerage", ...all])].slice(0, 150));
    });
  }, []);

  const set = (patch: Partial<LogForm>) => { setForm((f) => ({ ...f, ...patch })); setSaved(""); };
  const setTrip = (i: number, patch: Partial<Trip>) => set({ trips: form.trips.map((t, k) => (k === i ? { ...t, ...patch } : t)) });
  const addTrip = () => set({ trips: [...form.trips, blankTrip(form.trips.length + 1)] });
  const removeTrip = (i: number) => {
    const t = form.trips[i];
    if (t.id) setRemoved((r) => [...r, t.id!]);
    const rest = form.trips.filter((_, k) => k !== i);
    set({ trips: rest.length ? rest : [blankTrip(1)] });
  };

  async function addRider() {
    const name = prompt("Rider / messenger name")?.trim();
    if (!name) return;
    const { data, error } = await supabase.from("riders").insert({ name }).select("id").single();
    if (error) { setError(error.message); return; }
    await reloadRiders();
    setRiderId((data as { id: number }).id);
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!riderId) { setError("Choose the rider first."); return; }
    const odoStart = numOrNull(form.odo_start), odoEnd = numOrNull(form.odo_end);
    if ([odoStart, odoEnd].some((v) => v != null && !(v >= 0))) { setError("Enter the odometer readings as numbers."); return; }
    if (odoStart != null && odoEnd != null && odoEnd < odoStart) { setError("The odometer end is lower than the odometer start."); return; }
    setBusy(true); setError(""); setSaved("");
    const row = {
      log_date: date, rider_id: riderId, vehicle: text(form.vehicle), odo_start: odoStart, odo_end: odoEnd,
      gas: amount(form.gas), food: amount(form.food), other_amount: amount(form.other_amount),
      misc_details: text(form.misc_details), remarks: text(form.remarks),
    };
    const fail = (m: string) => { setBusy(false); setError(m); };
    let logId = form.id;
    if (logId) {
      const { error } = await supabase.from("rider_logs").update(row).eq("id", logId);
      if (error) return fail(error.message);
    } else {
      const { data, error } = await supabase.from("rider_logs").insert(row).select("id").single();
      if (error) return fail(error.message.includes("duplicate") ? "This rider already has a record for this date. Reload the page to open it." : error.message);
      logId = (data as { id: number }).id;
    }
    const tripRow = (t: Trip, i: number) => ({
      log_id: logId, seq: i + 1, purpose: t.purpose, from_place: text(t.from_place), to_place: text(t.to_place), shipping_line: text(t.shipping_line),
      contact: text(t.contact), details: text(t.details), job_no: text(t.job_no), time_out: text(t.time_out), time_in: text(t.time_in), status: t.status,
    });
    const kept = form.trips.filter((t) => t.id || !emptyTrip(t));
    const gone = [...removed, ...kept.filter((t) => t.id && emptyTrip(t)).map((t) => t.id!)];
    const live = kept.filter((t) => !(t.id && emptyTrip(t)));
    const rows = live.map((t, i) => ({ id: t.id, row: tripRow(t, i) }));
    const fresh = rows.filter((r) => !r.id).map((r) => r.row);
    const results = await Promise.all([
      ...rows.filter((r) => r.id).map((r) => supabase.from("rider_trips").update(r.row).eq("id", r.id!)),
      ...(fresh.length ? [supabase.from("rider_trips").insert(fresh)] : []),
      ...(gone.length ? [supabase.from("rider_trips").delete().in("id", gone)] : []),
    ] as PromiseLike<{ error: { message: string } | null }>[]);
    const bad = results.find((r) => r.error);
    if (bad) { await loadLog(); return fail(`The day was saved, but a trip was not: ${bad.error!.message}`); }
    setBusy(false);
    await Promise.all([loadLog(), loadDay()]);
    setSaved("Saved.");
  }

  const tripsFilled = form.trips.filter((t) => !emptyTrip(t)).length;
  const input = { disabled: locked };

  return (
    <>
      <form className="card" onSubmit={save}>
        <div className="row spread">
          <h2>{form.id ? "Daily record" : "New daily record"}{loading && <span className="count"> loading…</span>}</h2>
          {form.id && <span className="badge">Already saved, editing</span>}
        </div>
        <datalist id="rider-places">{places.map((p) => <option key={p} value={p} />)}</datalist>
        <datalist id="rider-lines">{SHIPPING_LINES.map((p) => <option key={p} value={p} />)}</datalist>
        <div className="grid">
          <label>Date<input type="date" value={date} max={today()} onChange={(e) => e.target.value && setDate(e.target.value)} required /></label>
          {isRider ? <label>Rider<input value={mine?.name ?? ""} disabled /></label> : (
            <label>Rider / messenger
              <span className="row">
                <select value={riderId ?? ""} onChange={(e) => setRiderId(Number(e.target.value) || null)} required style={{ flex: 1 }}>
                  {!riderId && <option value="">Choose…</option>}
                  {riders.filter((r) => r.active || r.id === riderId).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
                <button type="button" className="ghost" onClick={addRider}>+ Add rider</button>
              </span>
            </label>
          )}
          <label>Vehicle / plate no.<input value={form.vehicle} onChange={(e) => set({ vehicle: e.target.value })} placeholder="e.g. Honda Click / ABC 123" {...input} /></label>
          <label>Odometer start (km)<input inputMode="decimal" value={form.odo_start} onChange={(e) => set({ odo_start: e.target.value })} {...input} /></label>
          <label>Odometer end (km)<input inputMode="decimal" value={form.odo_end} onChange={(e) => set({ odo_end: e.target.value })} {...input} /></label>
        </div>
        {locked && <p className="warn-text">You can fill in today's or yesterday's record. For an older day, please ask the office to correct it.</p>}

        <h3>Itinerary: trips for the day</h3>
        {form.trips.map((t, i) => (
          <fieldset key={t.id ?? `new-${i}`} className="trip-card" disabled={locked}>
            <div className="row spread">
              <strong className="trip-no">Trip {i + 1}</strong>
              <button type="button" className="link danger-text" onClick={() => removeTrip(i)}>Remove</button>
            </div>
            <div className="grid">
              <label>What for
                <select value={t.purpose} onChange={(e) => setTrip(i, { purpose: e.target.value as Purpose })}>
                  {PURPOSES.map((p) => <option key={p} value={p}>{PURPOSE_LABEL[p]}</option>)}
                </select>
              </label>
              <label>From (company / place)<input list="rider-places" value={t.from_place ?? ""} onChange={(e) => setTrip(i, { from_place: e.target.value })} placeholder="e.g. VSA office" /></label>
              <label>To (company / place)<input list="rider-places" value={t.to_place ?? ""} onChange={(e) => setTrip(i, { to_place: e.target.value })} placeholder="e.g. client or shipping line office" /></label>
              <label>Shipping line<input list="rider-lines" value={t.shipping_line ?? ""} onChange={(e) => setTrip(i, { shipping_line: e.target.value })} placeholder="if any, e.g. Maersk" /></label>
              <label>Document / item<input value={t.details ?? ""} onChange={(e) => setTrip(i, { details: e.target.value })} placeholder="e.g. original BL, delivery order, check" /></label>
              <label>Shipment PN (optional)<input value={t.job_no ?? ""} onChange={(e) => setTrip(i, { job_no: e.target.value })} placeholder="e.g. HNC11-810-26" /></label>
              <label>Contact person / receiver<input value={t.contact ?? ""} onChange={(e) => setTrip(i, { contact: e.target.value })} placeholder="Name and phone" /></label>
              <label>Time out<input type="time" value={t.time_out ?? ""} onChange={(e) => setTrip(i, { time_out: e.target.value })} /></label>
              <label>Time in / done<input type="time" value={t.time_in ?? ""} onChange={(e) => setTrip(i, { time_in: e.target.value })} /></label>
              <label>Status
                <select value={t.status} onChange={(e) => setTrip(i, { status: e.target.value as TripStatus })}>
                  {TRIP_STATUSES.map((s) => <option key={s} value={s}>{TRIP_STATUS_LABEL[s]}</option>)}
                </select>
              </label>
            </div>
          </fieldset>
        ))}
        {!locked && <button type="button" className="ghost" onClick={addTrip}>+ Add trip</button>}

        <h3>Expenses for the day (₱)</h3>
        <div className="grid">
          <label>Gas / fuel<input inputMode="decimal" value={form.gas} onChange={(e) => set({ gas: e.target.value })} placeholder="0.00" {...input} /></label>
          <label>Food<input inputMode="decimal" value={form.food} onChange={(e) => set({ food: e.target.value })} placeholder="0.00" {...input} /></label>
          <label>Other<input inputMode="decimal" value={form.other_amount} onChange={(e) => set({ other_amount: e.target.value })} placeholder="0.00" {...input} /></label>
          <label>Other details (toll, parking, load…)<input value={form.misc_details} onChange={(e) => set({ misc_details: e.target.value })} placeholder="e.g. parking 50, toll 120" {...input} /></label>
        </div>
        <div className="tiles">
          <div className="tile main"><span>Total expenses today</span><strong>{peso(expensesOf({ gas: amount(form.gas), food: amount(form.food), other_amount: amount(form.other_amount) }))}</strong></div>
          <div className="tile"><span>Distance</span><strong>{distanceOf(form)} km</strong></div>
          <div className="tile"><span>Trips</span><strong>{tripsFilled}</strong></div>
        </div>
        <label>Remarks (optional)<textarea rows={2} value={form.remarks} onChange={(e) => set({ remarks: e.target.value })} placeholder="Anything notable about the day" {...input} /></label>
        {error && <p className="error" role="alert">{error}</p>}
        <div className="row" style={{ marginTop: 12 }}>
          <button disabled={busy || locked || !riderId}>{busy ? "Saving…" : form.id ? "Save changes" : "Save record"}</button>
          {saved && <span className="ok-text" role="status">{saved}</span>}
          {riderId && <Link className="button-like" to={`/riders/sheet/${riderId}/${date}`} target="_blank" rel="noopener">Print trip sheet</Link>}
        </div>
      </form>

      {form.id && riderId ? (
        <RiderPhotos logId={form.id} riderId={riderId} trips={form.trips.filter((t) => t.id)} locked={locked} />
      ) : (
        <section className="card"><h2>Photos and receipts</h2><p className="muted">Save the record first, then add photos of receipts and signed receiving copies here.</p></section>
      )}

      <section className="card">
        <h2>Saved records on {dayLabel(date)} <span className="count">{dayLogs.length}</span></h2>
        {dayLogs.length === 0 ? <p className="muted">No records for this date yet.</p> : dayLogs.map((l) => (
          <div key={l.id} className="day-log">
            <div className="row spread wrap">
              <strong>{l.riders?.name ?? rider?.name}</strong>
              <span className="row wrap stat-row">
                <span className="stat">Trips <strong>{l.rider_trips?.length ?? 0}</strong></span>
                <span className="stat">Distance <strong>{distanceOf(l)} km</strong></span>
                <span className="stat">Expenses <strong>{peso(expensesOf(l))}</strong></span>
                {!isRider && l.rider_id !== riderId && <button type="button" className="ghost small" onClick={() => { setRiderId(l.rider_id); window.scrollTo({ top: 0, behavior: "smooth" }); }}>Open</button>}
              </span>
            </div>
            <TripTable trips={(l.rider_trips ?? []).map((t) => ({ ...t, date: null, rider: null }))} />
          </div>
        ))}
      </section>
    </>
  );
}

// ---------- Photos of receipts and signed receiving copies ----------

function RiderPhotos({ logId, riderId, trips, locked }: { logId: number; riderId: number; trips: Trip[]; locked: boolean }) {
  const [photos, setPhotos] = useState<RiderPhoto[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [kind, setKind] = useState<PhotoKind>("receipt");
  const [tripId, setTripId] = useState<number | "">("");
  const [amt, setAmt] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const { data, error } = await supabase.from("rider_photos").select("*").eq("log_id", logId).order("id");
    if (error) { setError(error.message); return; }
    const list = (data as RiderPhoto[]) ?? [];
    setPhotos(list);
    if (list.length) {
      const { data: signed } = await supabase.storage.from("rider-files").createSignedUrls(list.map((p) => p.file_path), 3600);
      setUrls(Object.fromEntries((signed ?? []).filter((x) => x.signedUrl && x.path).map((x) => [x.path as string, x.signedUrl as string])));
    }
  }, [logId]);
  useEffect(() => { setError(""); load(); }, [load]);

  async function add(files: FileList | null) {
    if (!files?.length) return;
    const money = amt.trim() === "" ? null : Number(amt.replace(/,/g, ""));
    if (money != null && !(money >= 0)) { setError("Enter the amount as a number, or leave it blank."); return; }
    setError("");
    for (const [i, file] of [...files].entries()) {
      setBusy(files.length > 1 ? `Uploading ${i + 1} of ${files.length}…` : "Uploading…");
      try {
        const blob = await shrinkPhoto(file);
        const path = photoPath(riderId, logId);
        const up = await supabase.storage.from("rider-files").upload(path, blob, { contentType: "image/jpeg" });
        if (up.error) throw new Error(up.error.message);
        const row = { log_id: logId, trip_id: tripId || null, kind, amount: i === 0 ? money : null, note: note.trim() || null, file_path: path, size_bytes: blob.size };
        const { error } = await supabase.from("rider_photos").insert(row);
        if (error) { await supabase.storage.from("rider-files").remove([path]); throw new Error(error.message); }
      } catch (e) {
        setError(`${file.name}: ${(e as Error).message}`);
        break;
      }
    }
    setBusy(""); setAmt(""); setNote("");
    await load();
  }
  async function remove(p: RiderPhoto) {
    if (!confirm("Remove this photo?")) return;
    setBusy("Removing…");
    const { error } = await supabase.from("rider_photos").delete().eq("id", p.id);
    if (!error) await supabase.storage.from("rider-files").remove([p.file_path]);
    setBusy("");
    if (error) setError(error.message);
    await load();
  }

  const tripName = (id: number | null) => {
    const i = trips.findIndex((t) => t.id === id);
    return i < 0 ? "" : `Trip ${i + 1}${trips[i].to_place ? ` (${trips[i].to_place})` : ""}`;
  };
  const receipts = photos.filter((p) => p.kind === "receipt" && p.amount != null).reduce((a, p) => a + Number(p.amount), 0);

  return (
    <section className="card">
      <h2>Photos and receipts <span className="count">{photos.length}</span></h2>
      {!locked && (
        <div className="grid">
          <label>What is it
            <select value={kind} onChange={(e) => setKind(e.target.value as PhotoKind)}>
              {PHOTO_KINDS.map((k) => <option key={k} value={k}>{PHOTO_KIND_LABEL[k]}</option>)}
            </select>
          </label>
          <label>For which trip (optional)
            <select value={tripId} onChange={(e) => setTripId(Number(e.target.value) || "")}>
              <option value="">The whole day</option>
              {trips.map((t) => <option key={t.id} value={t.id}>{tripName(t.id!)}</option>)}
            </select>
          </label>
          {kind === "receipt" && <label>Amount on the receipt (₱)<input inputMode="decimal" value={amt} onChange={(e) => setAmt(e.target.value)} placeholder="0.00" /></label>}
          <label>Note (optional)<input value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Petron gas, NAIA toll" /></label>
          <label className="photo-pick">
            <span className="button-like">{busy || "📷 Take or choose photo"}</span>
            <input type="file" accept="image/*" capture="environment" multiple disabled={!!busy} hidden
              onChange={(e) => { add(e.target.files); e.target.value = ""; }} />
          </label>
        </div>
      )}
      {error && <p className="error" role="alert">{error}</p>}
      {photos.length === 0 ? <p className="muted small">No photos yet.</p> : (
        <>
          {receipts > 0 && <p className="small">Receipts with an amount: <strong>{peso(receipts)}</strong></p>}
          <ul className="photo-grid">
            {photos.map((p) => (
              <li key={p.id}>
                <a href={urls[p.file_path]} target="_blank" rel="noopener">
                  {urls[p.file_path] ? <img src={urls[p.file_path]} alt={PHOTO_KIND_LABEL[p.kind]} loading="lazy" /> : <span className="muted small">Loading…</span>}
                </a>
                <span className="small"><strong>{p.kind === "receipt" ? "Receipt" : p.kind === "proof" ? "Receiving copy" : "Photo"}</strong>
                  {p.amount != null && ` · ${peso(Number(p.amount))}`}</span>
                {p.trip_id && <span className="small muted">{tripName(p.trip_id)}</span>}
                {p.note && <span className="small muted">{p.note}</span>}
                {!locked && <button type="button" className="link danger-text small" disabled={!!busy} onClick={() => remove(p)}>Remove</button>}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

type TripRow = Trip & { date: string | null; rider: string | null };
/** Trips as a table; date and rider columns appear only when given. */
export function TripTable({ trips, linkPn = true }: { trips: TripRow[]; linkPn?: boolean }) {
  const { profile } = useAuth();
  const canOpen = linkPn && profile?.role !== "rider";
  const withDate = trips.some((t) => t.date), withRider = trips.some((t) => t.rider);
  if (!trips.length) return <p className="muted small">No trips.</p>;
  const sorted = [...trips].sort((a, b) => (a.date ?? "").localeCompare(b.date ?? "") || (a.rider ?? "").localeCompare(b.rider ?? "") || a.seq - b.seq);
  return (
    <div className="table-scroll">
      <table className="small wide-table">
        <thead><tr>{withDate && <th>Date</th>}{withRider && <th>Rider</th>}<th>What for</th><th>From</th><th>To</th><th>Shipping line</th><th>Document / item</th><th>PN</th><th>Contact</th><th>Out</th><th>In</th><th>Status</th></tr></thead>
        <tbody>
          {sorted.map((t, i) => (
            <tr key={t.id ?? i}>
              {withDate && <td className="nowrap">{dayLabel(t.date)}</td>}
              {withRider && <td>{t.rider}</td>}
              <td>{PURPOSE_LABEL[t.purpose]}</td><td>{t.from_place}</td><td>{t.to_place}</td><td>{t.shipping_line}</td><td>{t.details}</td>
              <td className="nowrap">{t.job_no && (canOpen && t.job_id ? <Link to={`/jobs/${t.job_id}`}>{t.job_no}</Link> : t.job_no)}</td>
              <td>{t.contact}</td><td className="nowrap">{hhmm(t.time_out)}</td><td className="nowrap">{hhmm(t.time_in)}</td>
              <td><span className={"badge trip-" + t.status}>{TRIP_STATUS_LABEL[t.status]}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------- Reports ----------

function RiderReports({ riders, mine }: { riders: Rider[]; mine: Rider | null }) {
  const [from, setFrom] = useState(today().slice(0, 8) + "01");
  const [to, setTo] = useState(today());
  const [riderId, setRiderId] = useState<number | "">(mine?.id ?? "");
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<TripStatus | "">("");
  const [logs, setLogs] = useState<RiderLog[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!from || !to) return;
    setLoading(true);
    fetchAll<RiderLog>((a, b) => {
      let query = supabase.from("rider_logs").select("*, riders(name), rider_trips(*)").gte("log_date", from).lte("log_date", to);
      if (riderId) query = query.eq("rider_id", riderId);
      return query.order("log_date").order("id").range(a, b) as never;
    }).then((rows) => { setError(""); setLogs(rows); setLoading(false); }, (e: Error) => { setError(e.message); setLogs([]); setLoading(false); });
  }, [from, to, riderId]);

  const summary = useMemo(() => {
    const by = new Map<number, { name: string; days: number; trips: number; km: number; gas: number; food: number; other: number }>();
    for (const l of logs) {
      const s = by.get(l.rider_id) ?? { name: l.riders?.name ?? "", days: 0, trips: 0, km: 0, gas: 0, food: 0, other: 0 };
      s.days++; s.trips += l.rider_trips?.length ?? 0; s.km += distanceOf(l); s.gas += Number(l.gas); s.food += Number(l.food); s.other += Number(l.other_amount);
      by.set(l.rider_id, s);
    }
    return [...by.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [logs]);
  const all = summary.reduce((t, s) => ({ days: t.days + s.days, trips: t.trips + s.trips, km: t.km + s.km, gas: t.gas + s.gas, food: t.food + s.food, other: t.other + s.other }),
    { days: 0, trips: 0, km: 0, gas: 0, food: 0, other: 0 });

  const trips = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return logs.flatMap((l) => (l.rider_trips ?? []).map((t) => ({ ...t, date: l.log_date, rider: l.riders?.name ?? "" })))
      .filter((t) => !status || t.status === status)
      .filter((t) => !needle || [t.from_place, t.to_place, t.shipping_line, t.details, t.job_no, t.contact, t.rider].some((v) => (v ?? "").toLowerCase().includes(needle)));
  }, [logs, q, status]);

  async function download() {
    setBusy(true);
    try {
      const { default: writeExcelFile } = await import("write-excel-file/browser");
      const t = (v: string | null | undefined) => (v ? { value: v, type: String } : null);
      const d = (v: string | null) => (v ? { value: new Date(v + "T00:00:00Z"), type: Date, format: "yyyy-mm-dd" } : null);
      const n = (v: number) => ({ value: Math.round(v * 100) / 100, type: Number });
      const bold = (h: string) => ({ value: h, fontWeight: "bold" as const });
      const tripCols: [string, number, (x: TripRow) => unknown][] = [
        ["Date", 12, (x) => d(x.date)], ["Rider", 20, (x) => t(x.rider)], ["What for", 20, (x) => t(PURPOSE_LABEL[x.purpose])], ["From", 26, (x) => t(x.from_place)],
        ["To", 26, (x) => t(x.to_place)], ["Shipping line", 18, (x) => t(x.shipping_line)], ["Document / item", 30, (x) => t(x.details)], ["PN", 16, (x) => t(x.job_no)],
        ["Contact", 22, (x) => t(x.contact)], ["Time out", 9, (x) => t(hhmm(x.time_out))], ["Time in", 9, (x) => t(hhmm(x.time_in))], ["Status", 16, (x) => t(TRIP_STATUS_LABEL[x.status])],
      ];
      const sorted = [...trips].sort((a, b) => (a.date ?? "").localeCompare(b.date ?? "") || (a.rider ?? "").localeCompare(b.rider ?? "") || a.seq - b.seq);
      const sheet1 = [tripCols.map(([h]) => bold(h)), ...sorted.map((x) => tripCols.map(([, , g]) => g(x)))];
      const sheet2 = [
        ["Rider", "Days", "Trips", "Distance (km)", "Gas", "Food", "Other", "Total expenses"].map(bold),
        ...summary.map((s) => [t(s.name), n(s.days), n(s.trips), n(s.km), n(s.gas), n(s.food), n(s.other), n(s.gas + s.food + s.other)]),
        [bold("All riders"), n(all.days), n(all.trips), n(all.km), n(all.gas), n(all.food), n(all.other), n(all.gas + all.food + all.other)],
      ];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (writeExcelFile as any)([
        { data: sheet1, sheet: "Trips", columns: tripCols.map(([, w]) => ({ width: w })), stickyRowsCount: 1 },
        { data: sheet2, sheet: "Totals per rider", columns: [22, 8, 8, 14, 12, 12, 12, 16].map((w) => ({ width: w })), stickyRowsCount: 1 },
      ]).toFile(`VSA rider report ${from} to ${to}.xlsx`);
    } catch (e) { setError(`Could not create the spreadsheet: ${(e as Error).message}`); }
    setBusy(false);
  }

  return (
    <>
      <section className="card">
        <div className="grid">
          <label>From<input type="date" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} /></label>
          <label>To<input type="date" value={to} min={from} onChange={(e) => e.target.value && setTo(e.target.value)} /></label>
          {!mine && (
            <label>Rider
              <select value={riderId} onChange={(e) => setRiderId(Number(e.target.value) || "")}>
                <option value="">All riders</option>
                {riders.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </label>
          )}
        </div>
        {error && <p className="error">{error}</p>}
        <div className="tiles">
          <div className="tile main"><span>Total expenses</span><strong>{peso(all.gas + all.food + all.other)}</strong></div>
          <div className="tile"><span>Trips</span><strong>{all.trips}</strong></div>
          <div className="tile"><span>Distance</span><strong>{Math.round(all.km * 10) / 10} km</strong></div>
          <div className="tile"><span>Days logged</span><strong>{all.days}</strong></div>
        </div>
        <h2>Totals per rider</h2>
        {loading ? <p className="muted">Loading…</p> : summary.length === 0 ? <p className="muted">No records in these dates.</p> : (
          <div className="table-scroll">
            <table className="small">
              <thead><tr><th>Rider</th><th className="num">Days</th><th className="num">Trips</th><th className="num">Distance</th><th className="num">Gas</th><th className="num">Food</th><th className="num">Other</th><th className="num">Total</th></tr></thead>
              <tbody>
                {summary.map((s) => (
                  <tr key={s.name}><td>{s.name}</td><td className="num">{s.days}</td><td className="num">{s.trips}</td><td className="num">{Math.round(s.km * 10) / 10} km</td>
                    <td className="num">{money(s.gas)}</td><td className="num">{money(s.food)}</td><td className="num">{money(s.other)}</td><td className="num"><strong>{money(s.gas + s.food + s.other)}</strong></td></tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card">
        <div className="row spread wrap">
          <h2>Document pick-up and delivery monitoring <span className="count">{trips.length}</span></h2>
          <button type="button" onClick={download} disabled={busy || !logs.length}>{busy ? "Preparing…" : "Download Excel"}</button>
        </div>
        <div className="grid">
          <label>Search company, shipping line, document or PN<input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. Maersk, original BL, HNC11" /></label>
          <label>Status
            <select value={status} onChange={(e) => setStatus(e.target.value as TripStatus | "")}>
              <option value="">Any status</option>
              {TRIP_STATUSES.map((s) => <option key={s} value={s}>{TRIP_STATUS_LABEL[s]}</option>)}
            </select>
          </label>
        </div>
        {loading ? <p className="muted">Loading…</p> : <TripTable trips={trips} />}
      </section>
    </>
  );
}

// ---------- Riders (office only) ----------

function RiderData({ riders, reload }: { riders: Rider[]; reload: () => Promise<void> }) {
  const [logins, setLogins] = useState<Profile[]>([]);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase.from("profiles").select("*").eq("role", "rider").order("full_name").then(({ data }) => setLogins((data as Profile[]) ?? []));
  }, []);

  async function change(r: Rider, patch: Partial<Rider>) {
    setBusy(true); setError("");
    const { error } = await supabase.from("riders").update(patch).eq("id", r.id);
    setBusy(false);
    if (error) setError(error.message.includes("riders_profile_id_key") ? "That login is already linked to another rider." : error.message);
    await reload();
  }
  async function add(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true); setError("");
    const { error } = await supabase.from("riders").insert({ name: name.trim() });
    setBusy(false);
    if (error) { setError(error.message); return; }
    setName(""); await reload();
  }

  return (
    <section className="card">
      <h2>Riders and messengers <span className="count">{riders.length}</span></h2>
      <p className="muted small">
        To let a rider log on their own phone: invite their email in Team with the role Rider, then choose their login here.
        A rider sees only this itinerary page and only their own records.
      </p>
      {error && <p className="error" role="alert">{error}</p>}
      {riders.length > 0 && (
        <div className="table-scroll">
          <table className="small">
            <thead><tr><th>Name</th><th>Vehicle</th><th>Plate no.</th><th>Login</th><th>Active</th></tr></thead>
            <tbody>
              {riders.map((r) => (
                <tr key={r.id} className={r.active ? "" : "muted-row"}>
                  <td><input defaultValue={r.name} aria-label="Rider name" onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== r.name) change(r, { name: v }); else e.target.value = r.name; }} /></td>
                  <td><input defaultValue={r.vehicle ?? ""} aria-label="Vehicle" placeholder="e.g. Honda Click" onBlur={(e) => { const v = text(e.target.value); if (v !== r.vehicle) change(r, { vehicle: v }); }} /></td>
                  <td><input defaultValue={r.plate_no ?? ""} aria-label="Plate number" onBlur={(e) => { const v = text(e.target.value); if (v !== r.plate_no) change(r, { plate_no: v }); }} /></td>
                  <td>
                    <select value={r.profile_id ?? ""} aria-label="Login" disabled={busy} onChange={(e) => change(r, { profile_id: e.target.value || null })}>
                      <option value="">No login (office encodes)</option>
                      {logins.map((p) => <option key={p.id} value={p.id}>{p.full_name || p.email}</option>)}
                    </select>
                  </td>
                  <td><input type="checkbox" checked={r.active} aria-label="Active" disabled={busy} onChange={(e) => change(r, { active: e.target.checked })} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <form className="row wrap" onSubmit={add} style={{ marginTop: 12 }}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New rider's name" aria-label="New rider's name" />
        <button disabled={busy || !name.trim()}>Add rider</button>
      </form>
    </section>
  );
}
