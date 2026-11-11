import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import {
  DOC_TYPES, PLACEHOLDER_CLIENT, STATUS_LABEL, allowedNextStatuses, canEditJobs, pretty,
  type Client, type Job, type JobDocument, type JobStatus, type Profile, type ScanResult, type StatusHistory,
} from "../lib/types";
import { partsOf, summarize, summaryRows } from "../lib/shipment";
import { runScan, uploadDocs } from "../lib/docs";
import JobFields, { fromJob, toRow, type JobForm } from "./JobFields";

const fmt = (iso: string) => new Date(iso).toLocaleString();
const secs = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
const show = (v: unknown) => (v == null ? "—" : typeof v === "object" ? JSON.stringify(v) : String(v));

export default function JobFile() {
  const { id } = useParams();
  const nav = useNavigate();
  const location = useLocation();
  const arrived = (location.state ?? {}) as { filled?: string[]; error?: string };
  const { profile } = useAuth();
  const role = profile!.role;
  const editable = canEditJobs(role);

  const [job, setJob] = useState<Job | null>(null);
  const [docs, setDocs] = useState<JobDocument[]>([]);
  const [scans, setScans] = useState<ScanResult[]>([]);
  const [history, setHistory] = useState<StatusHistory[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [staff, setStaff] = useState<Profile[]>([]);
  const [form, setForm] = useState<JobForm | null>(null);
  const [error, setError] = useState(arrived.error ?? "");
  const [notFound, setNotFound] = useState(false);
  const [busy, setBusy] = useState("");
  const [docType, setDocType] = useState<string>("other");
  const [openDoc, setOpenDoc] = useState<string | null>(null);
  const [filled, setFilled] = useState<string[]>(arrived.filled ?? []);
  // A running clock while documents are uploading or being read.
  const [since, setSince] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (since == null) return;
    const tick = () => setElapsed(Math.floor((Date.now() - since) / 1000));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [since]);

  const load = useCallback(async () => {
    const [j, d, s, h] = await Promise.all([
      supabase.from("jobs").select("*, clients(name), processor:profiles!jobs_processor_id_fkey(full_name,email)").eq("id", id!).maybeSingle(),
      supabase.from("job_documents").select("*").eq("job_id", id!).order("uploaded_at"),
      supabase.from("scan_results").select("*").eq("job_id", id!).order("run_at", { ascending: false }).limit(5),
      supabase.from("job_status_history").select("*").eq("job_id", id!).order("changed_at"),
    ]);
    if (j.error) setError(j.error.message);
    if (!j.data) setNotFound(true);
    setJob(j.data as Job | null);
    setDocs((d.data as JobDocument[]) ?? []);
    setScans((s.data as ScanResult[]) ?? []);
    setHistory((h.data as StatusHistory[]) ?? []);
  }, [id]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!editable) return;
    supabase.from("clients").select("*").order("name").then(({ data }) => setClients((data as Client[]) ?? []));
    supabase.from("profiles").select("*").in("role", ["owner", "processor"]).then(({ data }) => setStaff((data as Profile[]) ?? []));
  }, [editable]);

  if (notFound) return <p className="muted">Job not found.</p>;
  if (!job) return <p className="muted">Loading…</p>;

  async function run(label: string, fn: () => Promise<string | void>) {
    setBusy(label);
    setError("");
    if (label === "upload" || label === "scan") setSince(Date.now());
    try {
      const err = await fn();
      if (err) setError(err);
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy("");
    setSince(null);
    await load();
  }

  const setStatus = (s: JobStatus) => run("status", async () => {
    const { error } = await supabase.from("jobs").update({ status: s }).eq("id", job.id);
    return error?.message;
  });

  const save = (e: FormEvent) => {
    e.preventDefault();
    run("save", async () => {
      const { error } = await supabase.from("jobs").update(toRow(form!)).eq("id", job.id);
      if (error) return error.message;
      setForm(null);
    });
  };

  /** Read the documents; the scan also fills in any job details that are still empty. */
  async function scanNow(force: boolean): Promise<string | undefined> {
    const outcome = await runScan(job!.id, force);
    if (outcome.error) return outcome.error;
    setFilled(outcome.filled);
  }

  const upload = (files: FileList | null) => {
    if (!files?.length) return;
    run("upload", async () => {
      const { uploaded, problems } = await uploadDocs(job.id, Array.from(files), docType, profile!.id);
      if (editable && uploaded > 0) {
        setBusy("scan");
        const err = await scanNow(false);
        if (err) problems.push(`Uploaded, but reading the documents failed: ${err}`);
      }
      return problems.join("\n") || undefined;
    });
  };

  const view = async (d: JobDocument) => {
    const { data, error } = await supabase.storage.from("job-docs").createSignedUrl(d.file_path, 120);
    if (error) setError(error.message);
    else window.open(data.signedUrl, "_blank", "noopener");
  };

  const removeDoc = (d: JobDocument) => {
    if (!confirm(`Delete ${d.file_name}?`)) return;
    run("delete", async () => {
      const { error } = await supabase.from("job_documents").delete().eq("id", d.id);
      if (error) return error.message;
      const rm = await supabase.storage.from("job-docs").remove([d.file_path]);
      return rm.error?.message;
    });
  };

  const scan = (force: boolean) => run("scan", () => scanNow(force));

  const deleteJob = () => {
    if (!confirm(`Delete job ${job.job_no}? This cannot be undone.`)) return;
    run("delete", async () => {
      // Deleting the job removes its document records, so remove the stored files first.
      if (docs.length) {
        const rm = await supabase.storage.from("job-docs").remove(docs.map((d) => d.file_path));
        if (rm.error) return `Could not delete this job's files: ${rm.error.message}`;
      }
      const { error } = await supabase.from("jobs").delete().eq("id", job.id);
      if (error) return error.message;
      nav("/");
    });
  };

  const next = allowedNextStatuses(role, job.status);
  const latest = scans[0];
  const summary = summaryRows(summarize(docs));
  const unassigned = job.clients?.name === PLACEHOLDER_CLIENT;

  return (
    <>
      <div className="row spread">
        <h1>{job.job_no} <span className="badge">{STATUS_LABEL[job.status]}</span></h1>
        <div className="row">
          {next.map((s) => (
            <button key={s} disabled={!!busy} onClick={() => setStatus(s)}>Mark {STATUS_LABEL[s]}</button>
          ))}
        </div>
      </div>
      {error && <p className="error pre">{error}</p>}
      {filled.length > 0 && (
        <p className="ok">Filled in from the documents: {filled.join(", ")}. Check them against the originals.</p>
      )}
      {unassigned && (
        <p className="warn">
          No client yet. It is set from the consignee once a document naming one has been read.
          {editable ? " You can also choose it with Edit." : ""}
        </p>
      )}

      <section className="card">
        <div className="row spread">
          <h2>Job details</h2>
          {editable && !form && <button className="ghost" onClick={() => setForm(fromJob(job))}>Edit</button>}
        </div>
        {form ? (
          <form onSubmit={save}>
            <JobFields form={form} setForm={setForm} clients={clients} staff={staff} />
            <div className="row">
              <button disabled={!!busy}>Save</button>
              <button type="button" className="ghost" onClick={() => setForm(null)}>Cancel</button>
            </div>
          </form>
        ) : (
          <dl className="details">
            <dt>Client</dt><dd>{job.clients?.name}</dd>
            <dt>Service</dt><dd>{pretty(job.service_type)}</dd>
            <dt>BL / AWB no.</dt><dd>{show(job.bl_awb_no)}</dd>
            <dt>Entry no.</dt><dd>{show(job.entry_no)}</dd>
            <dt>Containers</dt><dd>{job.containers?.length ? job.containers.join(", ") : "—"}</dd>
            <dt>Vessel / voyage</dt><dd>{show(job.vessel)} / {show(job.voyage)}</dd>
            <dt>ETA</dt><dd>{show(job.eta)}</dd>
            <dt>Port of discharge</dt><dd>{show(job.port_of_discharge)}</dd>
            <dt>Carrier</dt><dd>{show(job.carrier)}</dd>
            <dt>Booking no.</dt><dd>{show(job.booking_no)}</dd>
            <dt>Processor</dt><dd>{job.processor ? job.processor.full_name || job.processor.email : "Unassigned"}</dd>
            <dt>Notes</dt><dd>{show(job.notes)}</dd>
          </dl>
        )}
      </section>

      {summary.length > 0 && (
        <section className="card">
          <h2>Shipment summary</h2>
          <p className="muted small">Read from the documents. Check against the originals before filing.</p>
          <dl className="details">
            {summary.map(([k, v]) => <div key={k} className="pair"><dt>{k}</dt><dd>{v}</dd></div>)}
          </dl>
        </section>
      )}

      <section className="card">
        <h2>Documents</h2>
        <div className="row">
          <select value={docType} onChange={(e) => setDocType(e.target.value)} aria-label="Document type">
            <option value="other">Detect the type automatically</option>
            {DOC_TYPES.filter((t) => t !== "other").map((t) => <option key={t} value={t}>{pretty(t)}</option>)}
          </select>
          <input type="file" multiple accept=".pdf,.png,.jpg,.jpeg" disabled={!!busy}
            onChange={(e) => { upload(e.target.files); e.target.value = ""; }} />
          {busy === "upload" && <span className="muted">Uploading… {elapsed} s</span>}
          {busy === "scan" && <span className="muted">Reading the documents… {elapsed} s</span>}
        </div>
        <p className="muted small">
          PDF, PNG or JPG, up to 10 MB each.
          {editable ? " Files are read automatically after upload, and several documents in one PDF are fine." : ""}
        </p>
        {docs.length === 0 ? <p className="muted">No documents uploaded yet.</p> : (
          <table>
            <thead><tr><th>Type</th><th>File</th><th>Uploaded</th><th>Reading</th><th></th></tr></thead>
            <tbody>
              {docs.map((d) => (
                <DocRow key={d.id} d={d} open={openDoc === d.id} canDelete={editable}
                  onToggle={() => setOpenDoc(openDoc === d.id ? null : d.id)} onView={() => view(d)} onDelete={() => removeDoc(d)} />
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="card">
        <div className="row spread">
          <h2>Document check</h2>
          {editable && (
            <div className="row">
              <button disabled={!!busy || docs.length === 0} onClick={() => scan(false)}>
                {busy === "scan" ? `Checking… ${elapsed} s` : "Check documents"}
              </button>
              {docs.some((d) => d.extracted) && (
                <button className="ghost" disabled={!!busy} onClick={() => scan(true)}>Re-read all</button>
              )}
            </div>
          )}
        </div>
        <p className="muted small">
          Checks that the Bill of Lading / Airway Bill, Commercial Invoice and Packing List agree on shipper, consignee,
          BL number, containers, weights, packages, invoice totals and goods description.
        </p>
        {!latest ? <p className="muted">The documents have not been checked yet.</p> : (
          <>
            <p>
              Last run {fmt(latest.run_at)} · {latest.docs_scanned} file(s) read ·{" "}
              {latest.duration_ms != null && <>took {secs(latest.duration_ms)} ·{" "}</>}
              <span className={latest.error_count ? "error" : "ok"}>{latest.error_count} error(s)</span> ·{" "}
              <span className={latest.warning_count ? "warn" : "ok"}>{latest.warning_count} warning(s)</span>
            </p>
            {latest.issues.map((i, k) => (
              <div key={k} className={"finding " + i.severity}>
                <strong>{i.severity === "error" ? "Error" : "Warning"} · {pretty(i.check)}</strong>
                <div>{i.message}</div>
                {i.values?.length > 0 && (
                  <ul>{i.values.map((v, n) => <li key={n}><span className="muted">{v.source}:</span> {show(v.value)}</li>)}</ul>
                )}
              </div>
            ))}
            {latest.matches.length > 0 && (
              <details>
                <summary>{latest.matches.length} check(s) passed</summary>
                <ul>
                  {latest.matches.map((m, k) => (
                    <li key={k}><strong>{pretty(m.check)}</strong>: {show(m.value)} <span className="muted small">({m.sources.join("; ")})</span></li>
                  ))}
                </ul>
              </details>
            )}
          </>
        )}
      </section>

      <section className="card">
        <h2>Status history</h2>
        <ul className="plain">
          {history.map((h) => (
            <li key={h.id}>
              {fmt(h.changed_at)} — {h.from_status ? `${STATUS_LABEL[h.from_status]} → ` : "Created as "}
              {STATUS_LABEL[h.to_status]} <span className="muted">by {h.changed_by_name ?? "system"}</span>
            </li>
          ))}
        </ul>
      </section>

      {role === "owner" && <button className="danger" disabled={!!busy} onClick={deleteJob}>Delete job</button>}
    </>
  );
}

function DocRow({ d, open, canDelete, onToggle, onView, onDelete }: {
  d: JobDocument; open: boolean; canDelete: boolean; onToggle: () => void; onView: () => void; onDelete: () => void;
}) {
  const parts = partsOf(d);
  const readMs = typeof d.extracted?._ms === "number" ? d.extracted._ms : null;
  const state = d.extracted ? (
    <>
      <button className="link" onClick={onToggle}>{open ? "Hide fields" : "Show fields"}</button>
      {readMs != null && <span className="muted small"> read in {secs(readMs)}</span>}
    </>
  )
    : d.extract_error ? <span className="error">Failed</span>
    : <span className="muted">Not read yet</span>;
  return (
    <>
      <tr>
        <td>
          {d.doc_type === "other" && !d.extracted ? "Not identified yet" : pretty(d.doc_type)}
          {parts.length > 1 && <span className="muted small"> · {parts.length} documents in this file</span>}
        </td>
        <td>{d.file_name}</td>
        <td className="muted small">{fmt(d.uploaded_at)}</td>
        <td>{state}</td>
        <td className="right">
          <button className="link" onClick={onView}>View</button>
          {canDelete && <button className="link danger-text" onClick={onDelete}>Delete</button>}
        </td>
      </tr>
      {open && parts.map((p, i) => (
        <tr key={i}><td colSpan={5}>
          {parts.length > 1 && <strong>{i + 1}. {pretty(p.type)}</strong>}
          <dl className="details">
            {Object.entries(p.fields).filter(([k, v]) => !k.startsWith("_") && k !== "doc_type_detected" && renderValue(v) !== "")
              .map(([k, v]) => <div key={k} className="pair"><dt>{pretty(k)}</dt><dd>{renderValue(v)}</dd></div>)}
          </dl>
        </td></tr>
      ))}
      {d.extract_error && !d.extracted && <tr><td colSpan={5} className="error small">{d.extract_error}</td></tr>}
    </>
  );
}

function renderValue(v: unknown): string {
  if (v == null) return "";
  if (Array.isArray(v)) {
    return v.map((x) => (x && typeof x === "object" ? Object.values(x).filter((y) => y != null).join(" | ") : String(x))).join("; ");
  }
  if (typeof v === "object") return Object.values(v).filter((y) => y != null).join(", ");
  return String(v);
}
