// Printable trip sheet: one rider's day on one page. Printed before the rider leaves (the planned trips,
// with blank boxes for who received, signature and time) and filed after, signed by the rider and
// checked by the office. A day with no record yet prints as a blank sheet to fill in by hand.
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { dayLabel } from "../lib/types";
import { peso } from "../lib/billing";
import { PURPOSE_LABEL, TRIP_STATUS_LABEL, distanceOf, expensesOf, hhmm, type Rider, type RiderLog, type Trip } from "../lib/riders";

const BLANK_ROWS = 8;

export default function RiderSheet() {
  const { riderId, date } = useParams();
  const [rider, setRider] = useState<Rider | null>(null);
  const [log, setLog] = useState<RiderLog | null>(null);
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    Promise.all([
      supabase.from("riders").select("*").eq("id", Number(riderId)).maybeSingle(),
      supabase.from("rider_logs").select("*, rider_trips(*)").eq("rider_id", Number(riderId)).eq("log_date", date!).maybeSingle(),
    ]).then(([r, l]) => {
      if (r.error || l.error) setError((r.error ?? l.error)!.message);
      else if (!r.data) setError("Rider not found.");
      setRider(r.data as Rider | null);
      setLog(l.data as RiderLog | null);
      setReady(true);
    });
  }, [riderId, date]);

  if (error) return <p className="error">{error}</p>;
  if (!ready || !rider) return <p className="muted">Loading…</p>;
  const trips: (Trip | null)[] = [...(log?.rider_trips ?? [])].sort((a, b) => a.seq - b.seq);
  while (trips.length < BLANK_ROWS) trips.push(null);
  const vehicle = log?.vehicle || [rider.vehicle, rider.plate_no].filter(Boolean).join(" / ");
  const n = (v: number | null | undefined) => (v == null ? "" : String(v));

  return (
    <>
      <div className="row no-print">
        <button type="button" onClick={() => window.print()}>Print</button>
        <span className="muted small">{log ? "Prints the trips saved for this day, with space for signatures." : "No record for this day yet: this prints a blank sheet to fill in by hand."}</span>
      </div>
      <article className="trip-sheet">
        <header className="trip-sheet-head">
          <div>
            <strong>VSA Customs Brokerage</strong>
            <h1>Rider trip sheet</h1>
          </div>
          <table className="trip-sheet-info">
            <tbody>
              <tr><th>Date</th><td>{dayLabel(date!)}</td></tr>
              <tr><th>Rider</th><td>{rider.name}</td></tr>
              <tr><th>Vehicle / plate</th><td>{vehicle}</td></tr>
              <tr><th>Odometer start</th><td>{n(log?.odo_start)}</td></tr>
              <tr><th>Odometer end</th><td>{n(log?.odo_end)}</td></tr>
            </tbody>
          </table>
        </header>

        <table className="trip-sheet-trips">
          <thead>
            <tr><th>#</th><th>What for</th><th>From → To</th><th>Document / item · PN</th><th>Out</th><th>In</th><th>Received by (name)</th><th>Signature</th><th>Status</th></tr>
          </thead>
          <tbody>
            {trips.map((t, i) => (
              <tr key={t?.id ?? `b${i}`}>
                <td>{i + 1}</td>
                <td>{t ? PURPOSE_LABEL[t.purpose] : ""}</td>
                <td>{t ? [t.from_place, t.to_place].filter(Boolean).join(" → ") : ""}{t?.shipping_line ? <div className="small">{t.shipping_line}</div> : null}</td>
                <td>{t?.details}{t?.job_no ? <div className="small">PN {t.job_no}</div> : null}{t?.contact ? <div className="small">{t.contact}</div> : null}</td>
                <td>{hhmm(t?.time_out)}</td>
                <td>{hhmm(t?.time_in)}</td>
                <td></td>
                <td></td>
                <td>{t && t.status !== "pending" ? TRIP_STATUS_LABEL[t.status] : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <section className="trip-sheet-foot">
          <table className="trip-sheet-info">
            <tbody>
              <tr><th>Gas / fuel</th><td>{log && Number(log.gas) ? peso(Number(log.gas)) : ""}</td></tr>
              <tr><th>Food</th><td>{log && Number(log.food) ? peso(Number(log.food)) : ""}</td></tr>
              <tr><th>Other{log?.misc_details ? ` (${log.misc_details})` : ""}</th><td>{log && Number(log.other_amount) ? peso(Number(log.other_amount)) : ""}</td></tr>
              <tr><th>Total expenses</th><td><strong>{log && expensesOf(log) ? peso(expensesOf(log)) : ""}</strong></td></tr>
              <tr><th>Distance</th><td>{log && distanceOf(log) ? `${distanceOf(log)} km` : ""}</td></tr>
            </tbody>
          </table>
          <div className="trip-sheet-sign">
            {log?.remarks && <p className="small">Remarks: {log.remarks}</p>}
            <div><span className="line" />Rider's signature</div>
            <div><span className="line" />Checked / approved by (office)</div>
          </div>
        </section>
      </article>
    </>
  );
}
