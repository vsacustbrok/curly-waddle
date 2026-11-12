// Month calendar of shipments by ETA, so the team can see what is arriving and when.
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { STATUS_LABEL, type Job } from "../lib/types";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const p2 = (x: number) => String(x).padStart(2, "0");
const ymd = (y: number, m: number, d: number) => `${y}-${p2(m + 1)}-${p2(d)}`;

export default function Calendar() {
  const now = new Date();
  const [month, setMonth] = useState({ y: now.getFullYear(), m: now.getMonth() });
  const [jobs, setJobs] = useState<Job[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const first = ymd(month.y, month.m, 1);
  const daysInMonth = new Date(month.y, month.m + 1, 0).getDate();
  const last = ymd(month.y, month.m, daysInMonth);
  const todayStr = ymd(now.getFullYear(), now.getMonth(), now.getDate());

  useEffect(() => {
    setLoading(true);
    supabase.from("jobs").select("id, job_no, status, eta, vessel, clients(name)")
      .gte("eta", first).lte("eta", last).order("eta")
      .then(({ data, error }) => {
        setError(error?.message ?? "");
        setJobs((data as unknown as Job[]) ?? []);
        setLoading(false);
      });
  }, [first, last]);

  const byDay = useMemo(() => {
    const map = new Map<string, Job[]>();
    for (const j of jobs) if (j.eta) map.set(j.eta, [...(map.get(j.eta) ?? []), j]);
    return map;
  }, [jobs]);

  const lead = new Date(month.y, month.m, 1).getDay();
  const cells: (number | null)[] = [...Array(lead).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];
  while (cells.length % 7) cells.push(null);
  const shift = (n: number) => setMonth(({ y, m }) => { const d = new Date(y, m + n, 1); return { y: d.getFullYear(), m: d.getMonth() }; });
  const title = new Date(month.y, month.m, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const upcoming = jobs.filter((j) => j.eta! >= todayStr).length;

  return (
    <>
      <div className="row spread">
        <h1>Arrival calendar</h1>
        <div className="row">
          <button className="ghost" onClick={() => shift(-1)} aria-label="Previous month">‹ Prev</button>
          <strong className="cal-title">{title}</strong>
          <button className="ghost" onClick={() => shift(1)} aria-label="Next month">Next ›</button>
          <button className="ghost" onClick={() => setMonth({ y: now.getFullYear(), m: now.getMonth() })}>This month</button>
        </div>
      </div>
      <p className="muted small">
        Shipments are placed on their ETA. {loading ? "Loading…" : `${jobs.length} this month, ${upcoming} still to arrive.`} Click a shipment to open it.
      </p>
      {error && <p className="error">{error}</p>}
      <section className="card cal">
        {WEEKDAYS.map((w) => <div key={w} className="cal-head">{w}</div>)}
        {cells.map((d, i) => {
          if (d == null) return <div key={i} className="cal-cell empty" />;
          const key = ymd(month.y, month.m, d);
          const list = byDay.get(key) ?? [];
          return (
            <div key={i} className={"cal-cell" + (key === todayStr ? " today" : "") + (key < todayStr ? " past" : "")}>
              <div className="cal-day">{d}</div>
              {list.map((j) => (
                <Link key={j.id} to={`/jobs/${j.id}`} className={"cal-item status-" + j.status} title={`${j.clients?.name ?? ""} · ${STATUS_LABEL[j.status]}`}>
                  <strong>{j.job_no}</strong> <span className="small">{j.clients?.name}</span>
                </Link>
              ))}
            </div>
          );
        })}
      </section>
    </>
  );
}
