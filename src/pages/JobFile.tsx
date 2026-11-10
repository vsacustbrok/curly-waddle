import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import {
  DOC_TYPES, SCANNED_TYPES, STATUS_LABEL, allowedNextStatuses, canEditJobs, pretty,
  type Client, type Job, type JobDocument, type JobStatus, type Profile, type ScanResult, type StatusHistory,
} from "../lib/types";
import JobFields, { fromJob, toRow, type JobForm } from "./JobFields";

const MAX_BYTES = 10 * 1024 * 1024;
const MIME_OK = ["application/pdf", "image/png", "image/jpeg"];
const fmt = (iso: string) => new Date(iso).toLocaleString();
const show = (v: unknown) => (v == null ? "—" : typeof v === "object" ? JSON.stringify(v) : String(v));

export default function JobFile() {
  const { id } = useParams();
  const nav = useNavigate();
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
  const [error, setError] = useState("");
  const [notFound, setNotFound] = useState(false);
  const [busy, setBusy] = useState("");
  const [docType, setDocType] = useState<string>("bill_of_lading");
  const [openDoc, setOpenDoc] = useState<string | null>(null);

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
    try {
      const err = await fn();
      if (err) setError(err);
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy("");
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

  const upload = (files: FileList | null) => {
    if (!files?.length) return;
    run("upload", async () => {
      const problems: string[] = [];
      for (const file of Array.from(files)) {
        if (!MIME_OK.includes(file.type)) { problems.push(`${file.name}: only PDF, PNG or JPG files are accepted`); continue; }
        if (file.size > MAX_BYTES) { problems.push(`${file.name}: larger than 10 MB`); continue; }
        const ext = file.name.includes(".") ? file.name.split(".").pop()!.toLowerCase().replace(/[^a-z0-9]/g, "") : "bin";
        const path = `${job.id}/${crypto.randomUUID()}.${ext}`;
        const up = await supabase.storage.from("job-docs").upload(path, file, { contentType: file.type });
        if (up.error) { problems.push(`${file.name}: ${up.error.message}`); continue; }
        const ins = await supabase.from("job_documents").insert({
          job_id: job.id, doc_type: docType, file_path: path, file_name: file.name,
          mime_type: file.type, size_bytes: file.size, uploaded_by: profile!.id,
        });
        if (ins.error) {
          await supabase.storage.from("job-docs").remove([path]);
          problems.push(`${file.name}: ${ins.error.message}`);
        }
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

  const scan = (force: boolean) => run("scan", async () => {
    const { data, error } = await supabase.functions.invoke("scan-job", { body: { job_id: job.id, force } });
    if (error) {
      // Non-2xx: the function's own message is in the response body.
      const ctx = (error as { context?: Response }).context;
      const body = ctx && typeof ctx.json === "function" ? await ctx.json().catch(() => null) : null;
      return body?.error ?? error.message;
    }
    if (data?.error) return data.error;
  });

  const deleteJob = () => {
    if (!confirm(`Delete job ${job.job_no}? This cannot be undone.`)) return;
    run("delete", async () => {
      const { error } = await supabase.from("jobs").delete().eq("id", job.id);
      if (error) return error.message.includes("foreign key") ? "Delete this job's documents first." : error.message;
      nav("/");
    });
  };

  const next = allowedNextStatuses(role, job.status);
  const scannable = docs.filter((d) => SCANNED_TYPES.has(d.doc_type));
  const latest = scans[0];

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

      <section className="card">
        <h2>Documents</h2>
        <div className="row">
          <select value={docType} onChange={(e) => setDocType(e.target.value)}>
            {DOC_TYPES.map((t) => <option key={t} value={t}>{pretty(t)}</option>)}
          </select>
          <input type="file" multiple accept=".pdf,.png,.jpg,.jpeg" disabled={!!busy}
            onChange={(e) => { upload(e.target.files); e.target.value = ""; }} />
          {busy === "upload" && <span className="muted">Uploading…</span>}
        </div>
        <p className="muted small">PDF, PNG or JPG, up to 10 MB each. Choose the document type before picking files.</p>
        {docs.length === 0 ? <p className="muted">No documents uploaded yet.</p> : (
          <table>
            <thead><tr><th>Type</th><th>File</th><th>Uploaded</th><th>Scan</th><th></th></tr></thead>
            <tbody>
              {docs.map((d) => (
                <FragmentRow key={d.id} d={d} open={openDoc === d.id} canDelete={editable}
                  onToggle={() => setOpenDoc(openDoc === d.id ? null : d.id)} onView={() => view(d)} onDelete={() => removeDoc(d)} />
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="card">
        <div className="row spread">
          <h2>Document scan</h2>
          {editable && (
            <div className="row">
              <button disabled={!!busy || scannable.length === 0} onClick={() => scan(false)}>
                {busy === "scan" ? "Scanning…" : "Scan documents"}
              </button>
              {scannable.some((d) => d.extracted) && (
                <button className="ghost" disabled={!!busy} onClick={() => scan(true)}>Re-read all</button>
              )}
            </div>
          )}
        </div>
        <p className="muted small">
          Reads the Bill of Lading / Airway Bill, Commercial Invoice and Packing List, then checks that shipper,
          consignee, BL number, containers, weights, packages, invoice totals and goods description agree.
          {busy === "scan" && " This can take a minute."}
        </p>
        {!latest ? <p className="muted">No scan has been run for this job.</p> : (
          <>
            <p>
              Last run {fmt(latest.run_at)} · {latest.docs_scanned} document(s) read ·{" "}
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

function FragmentRow({ d, open, canDelete, onToggle, onView, onDelete }: {
  d: JobDocument; open: boolean; canDelete: boolean; onToggle: () => void; onView: () => void; onDelete: () => void;
}) {
  const state = !SCANNED_TYPES.has(d.doc_type) ? <span className="muted">Not scanned</span>
    : d.extracted ? <button className="link" onClick={onToggle}>{open ? "Hide fields" : "Show fields"}</button>
    : d.extract_error ? <span className="error" title={d.extract_error}>Failed</span>
    : <span className="muted">Not read yet</span>;
  return (
    <>
      <tr>
        <td>{pretty(d.doc_type)}</td>
        <td>{d.file_name}</td>
        <td className="muted small">{fmt(d.uploaded_at)}</td>
        <td>{state}</td>
        <td className="right">
          <button className="link" onClick={onView}>View</button>
          {canDelete && <button className="link danger-text" onClick={onDelete}>Delete</button>}
        </td>
      </tr>
      {open && d.extracted && (
        <tr><td colSpan={5}>
          <dl className="details">
            {Object.entries(d.extracted).filter(([k, v]) => !k.startsWith("_") && v != null && !(Array.isArray(v) && v.length === 0))
              .map(([k, v]) => <div key={k} className="pair"><dt>{pretty(k)}</dt><dd>{renderValue(v)}</dd></div>)}
          </dl>
        </td></tr>
      )}
      {d.extract_error && !d.extracted && <tr><td colSpan={5} className="error small">{d.extract_error}</td></tr>}
    </>
  );
}

function renderValue(v: unknown): string {
  if (Array.isArray(v)) {
    return v.map((x) => (x && typeof x === "object" ? Object.values(x).filter((y) => y != null).join(" | ") : String(x))).join("; ");
  }
  if (v && typeof v === "object") return Object.values(v).filter((y) => y != null).join(", ");
  return String(v);
}
