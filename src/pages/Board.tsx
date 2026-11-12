import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { STATUSES, STATUS_LABEL, pretty, type Job, type Role, type JobStatus } from "../lib/types";

// The stages each role acts on, highlighted on their board.
const FOCUS: Record<Role, JobStatus[]> = {
  owner: [], pending: [],
  processor: ["pre_arrival", "lodged", "assessed", "paid"],
  dispatcher: ["released"],
  billing: ["assessed", "delivered"],
};

type Scan = { error_count: number; warning_count: number; run_at: string };
type BoardJob = Job & { scan_results?: Scan[] };

/** The result of the latest document check, as a small badge. */
function CheckBadge({ scans }: { scans?: Scan[] }) {
  const latest = [...(scans ?? [])].sort((a, b) => b.run_at.localeCompare(a.run_at))[0];
  if (!latest) return <span className="check-badge none">Not checked</span>;
  if (latest.error_count) return <span className="check-badge bad">{latest.error_count} to fix</span>;
  if (latest.warning_count) return <span className="check-badge review">{latest.warning_count} to review</span>;
  return <span className="check-badge good">Documents OK</span>;
}

export default function Board() {
  const { profile } = useAuth();
  const role = profile!.role;
  const [jobs, setJobs] = useState<BoardJob[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [mine, setMine] = useState(false);
  const [showBilled, setShowBilled] = useState(false);

  useEffect(() => {
    // The board is for this year's work: shipments lodged this year, or not lodged yet.
    // Earlier years stay under Shipments and Reports.
    const since = `${new Date().getFullYear()}-01-01`;
    supabase.from("jobs")
      .select("*, clients(name), processor:profiles!jobs_processor_id_fkey(full_name,email), scan_results(error_count, warning_count, run_at)")
      .or(`entry_filed_date.is.null,entry_filed_date.gte.${since}`)
      .order("eta", { ascending: true, nullsFirst: false })
      .then(({ data, error }) => {
        if (error) setError(error.message);
        setJobs((data as BoardJob[]) ?? []);
        setLoading(false);
      });
  }, []);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return jobs.filter((j) => {
      if (mine && j.processor_id !== profile!.id) return false;
      if (!needle) return true;
      return [j.job_no, j.clients?.name, j.client_ref_no, j.bl_awb_no, j.entry_no, j.ticket_no, j.trucker_plate_no, ...(j.containers ?? [])]
        .some((v) => v?.toLowerCase().includes(needle));
    });
  }, [jobs, q, mine, profile]);

  const columns = showBilled ? STATUSES : STATUSES.filter((s) => s !== "billed");
  const today = new Date().toISOString().slice(0, 10);

  return (
    <>
      <div className="row spread">
        <h1>Status board</h1>
        <div className="row">
          <input placeholder="Search PN, client, ref., BL, container, plate…" value={q} onChange={(e) => setQ(e.target.value)} />
          {role === "processor" && (
            <label className="check"><input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> My shipments</label>
          )}
          <label className="check"><input type="checkbox" checked={showBilled} onChange={(e) => setShowBilled(e.target.checked)} /> Show billed</label>
        </div>
      </div>
      <p className="muted small">{new Date().getFullYear()} shipments and any not lodged yet. Earlier years are under <Link to="/shipments">Shipments</Link>.</p>
      {error && <p className="error">{error}</p>}
      {loading ? <p className="muted">Loading…</p> : jobs.length === 0 ? (
        <p className="muted">No shipments yet.{(role === "owner" || role === "processor") && <> <Link to="/jobs/new">Create the first shipment</Link>.</>}</p>
      ) : (
        <div className="board">
          {columns.map((s) => {
            const list = filtered.filter((j) => j.status === s);
            return (
              <section key={s} className={"column col-" + s + (FOCUS[role].includes(s) ? " focus" : "")}>
                <h2>{STATUS_LABEL[s]} <span className="count">{list.length}</span></h2>
                {list.map((j) => (
                  <Link key={j.id} to={`/jobs/${j.id}`} className="jobcard">
                    <strong>{j.job_no}{j.entry_color && <span className={"entry-color " + j.entry_color}>{pretty(j.entry_color)}</span>}</strong>
                    <span>{j.clients?.name}</span>
                    <span className="muted small">{pretty(j.service_type)}{j.bl_awb_no ? ` · ${j.bl_awb_no}` : ""}</span>
                    {j.eta && (
                      <span className={"small " + (j.eta < today && STATUSES.indexOf(s) < 4 ? "error" : "muted")}>ETA {j.eta}</span>
                    )}
                    <CheckBadge scans={j.scan_results} />
                  </Link>
                ))}
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}
