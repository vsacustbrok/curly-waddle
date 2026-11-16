// Rider trips linked to a shipment by its PN: which documents were picked up or delivered, when, by whom.
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import type { Trip } from "../lib/riders";
import { TripTable } from "./Riders";

type Row = Trip & { rider_logs: { log_date: string; riders: { name: string } | null } | null };

export default function RiderTripsSection({ jobId }: { jobId: string }) {
  const [rows, setRows] = useState<Row[]>([]);
  useEffect(() => {
    let live = true;
    supabase.from("rider_trips").select("*, rider_logs(log_date, riders(name))").eq("job_id", jobId).order("id")
      .then(({ data }) => { if (live) setRows((data as Row[]) ?? []); });
    return () => { live = false; };
  }, [jobId]);
  if (!rows.length) return null;
  return (
    <section className="card">
      <h2>Rider trips <span className="count">{rows.length}</span></h2>
      <TripTable linkPn={false} trips={rows.map((t) => ({ ...t, date: t.rider_logs?.log_date ?? null, rider: t.rider_logs?.riders?.name ?? null }))} />
    </section>
  );
}
