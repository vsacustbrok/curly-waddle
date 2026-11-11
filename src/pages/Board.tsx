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

export default function Board() {
  const { profile } = useAuth();
  const role = profile!.role;
  const [jobs, setJobs] = useState<Job[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [mine, setMine] = useState(false);
  const [showBilled, setShowBilled] = useState(false);

  useEffect(() => {
    supabase.from("jobs")
      .select("*, clients(name), processor:profiles!jobs_processor_id_fkey(full_name,email)")
      .order("eta", { ascending: true, nullsFirst: false })
      .then(({ data, error }) => {
        if (error) setError(error.message);
        setJobs((data as Job[]) ?? []);
        setLoading(false);
      });
  }, []);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return jobs.filter((j) => {
      if (mine && j.processor_id !== profile!.id) return false;
      if (!needle) return true;
      return [j.job_no, j.clients?.name, j.bl_awb_no, j.entry_no, ...(j.containers ?? [])]
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
          <input placeholder="Search job, client, BL, container…" value={q} onChange={(e) => setQ(e.target.value)} />
          {role === "processor" && (
            <label className="check"><input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> My jobs</label>
          )}
          <label className="check"><input type="checkbox" checked={showBilled} onChange={(e) => setShowBilled(e.target.checked)} /> Show billed</label>
        </div>
      </div>
      {error && <p className="error">{error}</p>}
      {loading ? <p className="muted">Loading…</p> : jobs.length === 0 ? (
        <p className="muted">No jobs yet.{(role === "owner" || role === "processor") && <> <Link to="/jobs/new">Create the first shipment</Link>.</>}</p>
      ) : (
        <div className="board">
          {columns.map((s) => {
            const list = filtered.filter((j) => j.status === s);
            return (
              <section key={s} className={"column col-" + s + (FOCUS[role].includes(s) ? " focus" : "")}>
                <h2>{STATUS_LABEL[s]} <span className="count">{list.length}</span></h2>
                {list.map((j) => (
                  <Link key={j.id} to={`/jobs/${j.id}`} className="jobcard">
                    <strong>{j.job_no}</strong>
                    <span>{j.clients?.name}</span>
                    <span className="muted small">{pretty(j.service_type)}{j.bl_awb_no ? ` · ${j.bl_awb_no}` : ""}</span>
                    {j.eta && (
                      <span className={"small " + (j.eta < today && STATUSES.indexOf(s) < 4 ? "error" : "muted")}>ETA {j.eta}</span>
                    )}
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
