import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { markWords } from "../lib/keywords";
import BillingSection from "./BillingSection";
import { useAuth } from "../lib/auth";
import {
  BL_RELEASE_LABEL, DOC_GROUPS, PLACEHOLDER_CLIENT, STATUSES, dateTime, dayLabel, STATUS_LABEL, allowedNextStatuses, canEditJobs, checkLabel, pretty, prettySource,
  type Client, type Job, type JobDocument, type JobNote, type JobStatus, type Profile, type ScanResult, type StatusHistory,
} from "../lib/types";
import { partsOf, summarize, summaryRows } from "../lib/shipment";
import { nameScreenshot, runScan, uploadDocs } from "../lib/docs";
import JobFields, { ConfirmChanges, describeChanges, emptyJob, findDuplicates, fromJob, today, toRow, useFormHistory } from "./JobFields";

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
  const [editing, setEditing] = useState(false);
  const edit = useFormHistory(emptyJob);
  const [confirming, setConfirming] = useState<string[] | null>(null);
  const [dupes, setDupes] = useState<string[] | null>(null);
  const [notes, setNotes] = useState<JobNote[]>([]);
  const [noteDate, setNoteDate] = useState(today());
  const [noteText, setNoteText] = useState("");
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
    const [j, d, s, h, nt] = await Promise.all([
      supabase.from("jobs").select("*, clients(name, payment_terms_days), processor:profiles!jobs_processor_id_fkey(full_name,email)").eq("id", id!).maybeSingle(),
      supabase.from("job_documents").select("*").eq("job_id", id!).order("uploaded_at"),
      supabase.from("scan_results").select("*").eq("job_id", id!).order("run_at", { ascending: false }).limit(5),
      supabase.from("job_status_history").select("*").eq("job_id", id!).order("changed_at"),
      supabase.from("job_notes").select("*").eq("job_id", id!).order("note_date", { ascending: false }).order("id", { ascending: false }),
    ]);
    setNotes((nt.data as JobNote[]) ?? []);
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

  // Registry no.: kept once, in the Documents section.
  const [registry, setRegistry] = useState("");
  useEffect(() => { setRegistry(job?.registry_no ?? ""); }, [job?.registry_no]);
  // A screenshot pasted anywhere on the page (outside a text box) is added as a document.
  const [dragging, setDragging] = useState(false);
  const uploadRef = useRef<((files: File[]) => void) | null>(null);
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && t.closest("input, textarea, [contenteditable='true']")) return;
      const files = Array.from(e.clipboardData?.files ?? []).filter((f) => f.type.startsWith("image/") || f.type === "application/pdf");
      if (!files.length || !uploadRef.current) return;
      e.preventDefault();
      uploadRef.current(files.map(nameScreenshot));
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, []);

  if (notFound) return <p className="muted">Shipment not found.</p>;
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

  const form = edit.form;
  const startEdit = () => { edit.reset(fromJob(job)); setEditing(true); };
  /** Saving first shows what will change and waits for a confirmation. */
  const review = (e: FormEvent) => {
    e.preventDefault();
    setConfirming(describeChanges(fromJob(job), form, { clients, staff }));
    setDupes(null);
    findDuplicates(form, job.id).then(setDupes, () => setDupes([]));
  };
  const save = () => run("save", async () => {
    const { error } = await supabase.from("jobs").update(toRow(form)).eq("id", job.id);
    setConfirming(null);
    if (error?.message.includes("jobs_job_no_key")) return `PN ${form.job_no.trim()} is already used by another shipment. Choose a different one.`;
    if (error) return error.message;
    setEditing(false);
  });

  const addNote = (e: FormEvent) => {
    e.preventDefault();
    if (!noteText.trim()) return;
    run("note", async () => {
      const { error } = await supabase.from("job_notes").insert({ job_id: job.id, note_date: noteDate, body: noteText.trim(), author_id: profile!.id });
      if (error) return error.message;
      setNoteText("");
      setNoteDate(today());
    });
  };
  const removeNote = (n: JobNote) => {
    if (!confirm(`Delete the status note of ${dayLabel(n.note_date)}?`)) return;
    run("note", async () => {
      const { error } = await supabase.from("job_notes").delete().eq("id", n.id);
      return error?.message;
    });
  };

  /** Read the documents; the scan also fills in any job details that are still empty. */
  async function scanNow(force: boolean): Promise<string | undefined> {
    const outcome = await runScan(job!.id, force);
    if (outcome.error) return outcome.error;
    setFilled(outcome.filled);
  }

  const saveRegistry = (e: FormEvent) => {
    e.preventDefault();
    if (!job) return;
    run("save", async () => {
      const { error } = await supabase.from("jobs").update({ registry_no: registry.trim() || null }).eq("id", job.id);
      if (error) throw new Error(error.message);
      await load();
    });
  };
  const upload = (files: FileList | File[] | null) => {
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
  uploadRef.current = (files) => upload(files);

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
    if (!confirm(`Delete shipment ${job.job_no}? This cannot be undone.`)) return;
    run("delete", async () => {
      // Deleting the job removes its document records, so remove the stored files first.
      if (docs.length) {
        const rm = await supabase.storage.from("job-docs").remove(docs.map((d) => d.file_path));
        if (rm.error) return `Could not delete this shipment's files: ${rm.error.message}`;
      }
      const { error } = await supabase.from("jobs").delete().eq("id", job.id);
      if (error) return error.message;
      nav("/");
    });
  };

  const next = allowedNextStatuses(role, job.status);
  const latest = scans[0];
  // What the documents add to the project details: their own rows only, nothing already shown above.
  const summary = summaryRows(summarize(docs)).filter(([k, v]) =>
    !["BL / AWB no.", "Vessel / voyage", "Port of discharge", "Containers"].includes(k)
    && !(k === "Goods" && job && job.item_description && v.trim().toUpperCase() === job.item_description.trim().toUpperCase())
    && !(k === "Consignee" && job?.clients?.name && v.trim().toUpperCase() === job.clients.name.trim().toUpperCase()));
  const unassigned = job.clients?.name === PLACEHOLDER_CLIENT;

  return (
    <>
      <div className="row spread">
        <h1>{job.job_no} <span className={"badge status-" + job.status}>{STATUS_LABEL[job.status]}</span></h1>
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
          <h2>Project details</h2>
          {editable && !editing && <button className="ghost" onClick={startEdit}>Edit</button>}
        </div>
        {editing ? (
          <form onSubmit={review}>
            <JobFields history={edit} clients={clients} staff={staff} lodged={STATUSES.indexOf(job.status) >= STATUSES.indexOf("lodged")} />
            <div className="row">
              <button disabled={!!busy}>Save…</button>
              <button type="button" className="ghost" onClick={() => setEditing(false)}>Cancel</button>
            </div>
          </form>
        ) : (
          <div className="detail-groups">
            <Group title="1. Shipment and client" rows={[
              ["PN (project number)", job.job_no], ["Client", job.clients?.name], ["Client reference no.", job.client_ref_no],
              ["Item description", job.item_description], ["Supplier", job.supplier],
              ["Service", pretty(job.service_type)],
              ["Processor", job.processor ? job.processor.full_name || job.processor.email : "Unassigned"],
            ]} />
            <Group title="2. Arrival" rows={[
              ["Carrier", job.carrier], ["Vessel / voyage", [job.vessel, job.voyage].filter(Boolean).join(" / ") || null],
              ["BL / AWB no.", job.bl_awb_no], ["Booking no.", job.booking_no], ["ETA", dayLabel(job.eta)],
              ["Port of discharge", job.port_of_discharge], ["Warehouse", job.port_of_destination],
              ["Containers", job.containers?.length ? <span className="pre">{job.containers.join("\n")}</span> : null],
              ["Container size", [job.container_size, job.reefer == null ? null : job.reefer ? "Reefer" : "Dry"].filter(Boolean).join(", ") || null],
              ...(job.reefer ? [["Electric until", dateTime(job.electric_until)] as Row] : []),
            ]} />
            <Group title="3. CRO and BL release" rows={[
              ["CRO no.", job.cro_no], ["CRO valid until", dayLabel(job.cro_valid_until)],
              ["Storage free until", dayLabel(job.storage_free_until)], ["Demurrage free until", dayLabel(job.demurrage_free_until)],
              ["BL release by", job.bl_release_type ? BL_RELEASE_LABEL[job.bl_release_type] : null],
              ...(job.bl_release_type === "original" ? [["Original BL picked up", dayLabel(job.obl_pickup_date)] as Row,
                ["Original BL shipping date", dayLabel(job.obl_shipping_date)] as Row] : []),
              ...(job.bl_release_type === "telex" ? [["Telex released on", dayLabel(job.telex_release_date)] as Row] : []),
              ...(job.bl_release_type === "seaway" ? [["SWB date", dayLabel(job.telex_release_date)] as Row] : []),
            ]} />
            <Group title="4. Entry filing" rows={[
              ["Entry no.", job.entry_no], ["Entry filed on", dayLabel(job.entry_filed_date)], ["Ticket no.", job.ticket_no],
              ["Lodge code (lodge sheet)", job.lodge_status], ["DP / contract", job.dp_contract],
              ["Entry status", job.entry_status ? pretty(job.entry_status) : null],
              ["Entry color", job.entry_color ? <span className={"entry-color " + job.entry_color}>{pretty(job.entry_color)}</span> : null],
              ["Final SAD sent", job.final_sad_sent ? `Yes${job.final_sad_sent_date ? `, ${dayLabel(job.final_sad_sent_date)}` : ""}` : null],
              ["SSDT sent", job.ssdt_sent ? `Yes${job.ssdt_sent_date ? `, ${dayLabel(job.ssdt_sent_date)}` : ""}` : null],
            ]} />
            <Group title="5. Gatepass, TABS, release and delivery" rows={[
              ["Gatepass", [job.gatepass_ref, dayLabel(job.gatepass_date)].filter(Boolean).join(", ") ? <span className="kw-gatepass">{[job.gatepass_ref, dayLabel(job.gatepass_date)].filter(Boolean).join(", ")}</span> : null],
              ["TABS booking", [job.tabs_ref, dateTime(job.tabs_at)].filter(Boolean).join(", ") ? <span className="kw-tabs">{[job.tabs_ref, dateTime(job.tabs_at)].filter(Boolean).join(", ")}</span> : null],
              ["Yard", job.container_at_yard_at ? null : job.yard], ["Container at yard", dateTime(job.container_at_yard_at)], ["Released", dateTime(job.released_at)],
              ["Trucker", job.trucker_name], ["Plate no.", job.trucker_plate_no],
              ["Delivery address", job.delivery_address ? <span className="pre">{job.delivery_address}</span> : null],
              ["Empty return due", dayLabel(job.empty_return_due)],
              ["Empty return", [job.empty_return, dayLabel(job.empty_return_date)].filter(Boolean).join(", ") || null],
            ]} />
            {(job.lodge_remarks || job.lodge_remarks_2 || job.lodge_note || job.notes) && <Group title="6. Remarks and notes" rows={[
              ["Remarks", markWords(job.lodge_remarks)], ["Remarks 2", markWords(job.lodge_remarks_2)], ["Note", markWords(job.lodge_note)],
              ["General notes", job.notes ? <span className="pre">{markWords(job.notes)}</span> : null],
            ]} />}
          </div>
        )}
      </section>

      <section className="card">
        <h2>Daily status report</h2>
        <form className="note-form" onSubmit={addNote}>
          <input type="date" aria-label="Date of the update" value={noteDate} max={today()} required
            onChange={(e) => setNoteDate(e.target.value || today())}
            onKeyDown={(e) => { if (e.key !== "Tab") e.preventDefault(); }}
            onClick={(e) => e.currentTarget.showPicker?.()} />
          <textarea rows={2} placeholder="What happened on this shipment today? e.g. Entry lodged, waiting for assessment."
            value={noteText} onChange={(e) => setNoteText(e.target.value)} aria-label="Status update" />
          <button disabled={!!busy || !noteText.trim()}>Add update</button>
        </form>
        {notes.length === 0 ? <p className="muted">No status updates yet.</p> : (
          <ul className="note-log">
            {notes.map((n, i) => (
              <li key={n.id}>
                {(i === 0 || notes[i - 1].note_date !== n.note_date) && <div className="note-day">{dayLabel(n.note_date)}</div>}
                <div className="note-body">
                  <span className="pre">{markWords(n.body)}</span>
                  <span className="muted small"> · {n.author_name ?? "unknown"}, {new Date(n.created_at).toLocaleTimeString(undefined, { timeStyle: "short" })}</span>
                  {(n.author_id === profile!.id || role === "owner") && (
                    <button type="button" className="link danger-text small" onClick={() => removeNote(n)}>Delete</button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {summary.length > 0 && (
        <section className="card">
          <h2>Also read from the documents</h2>
          <p className="muted small">Details the documents add to the project details above. Check against the originals before filing.</p>
          <dl className="details">
            {summary.map(([k, v]) => <div key={k} className="pair"><dt>{k}</dt><dd>{v}</dd></div>)}
          </dl>
        </section>
      )}

      <section className={"card docs-drop" + (dragging ? " dragging" : "")}
        onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); setDragging(true); } }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); if (editable || role === "dispatcher" || role === "billing") upload(Array.from(e.dataTransfer.files)); }}>
        <h2>Documents</h2>
        <form className="row wrap registry" onSubmit={saveRegistry}>
          <label>Registry no.
            <input value={registry} onChange={(e) => setRegistry(e.target.value)} disabled={!editable} placeholder="e.g. 1234-26" style={{ width: "12em" }} />
          </label>
          {editable && registry.trim() !== (job.registry_no ?? "") && <button className="ghost small" disabled={!!busy}>Save</button>}
        </form>
        <div className="row">
          <select value={docType} onChange={(e) => setDocType(e.target.value)} aria-label="Document type">
            <option value="other">Detect the type automatically</option>
            {DOC_GROUPS.map(([group, types]) => (
              <optgroup key={group} label={group}>{types.map((t) => <option key={t} value={t}>{pretty(t)}</option>)}</optgroup>
            ))}
          </select>
          <label className={"filepick" + (busy ? " disabled" : "")}>
            + Add documents
            <input type="file" multiple accept=".pdf,image/*" disabled={!!busy}
              onChange={(e) => { upload(e.target.files); e.target.value = ""; }} />
          </label>
          {busy === "upload" && <span className="working">Uploading… {elapsed} s</span>}
          {busy === "scan" && <span className="working">Reading the documents… {elapsed} s</span>}
        </div>
        <p className="muted small">
          PDF or pictures (photos, PNG, JPG, screenshots), up to 10 MB each. Paste a screenshot with Ctrl+V, or drag files onto this box.
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
          Compares the documents with each other: parties, BL number, containers, weights, packages, invoice totals,
          goods, HS codes, Incoterms, origin, and the SPS clearance against the bill of lading.
        </p>
        {!latest ? <p className="muted">The documents have not been checked yet.</p> : (
          <>
            <div className={"verdict " + (latest.error_count ? "bad" : latest.warning_count ? "review" : "good")}>
              <strong>
                {latest.error_count
                  ? `${latest.error_count} problem${latest.error_count === 1 ? "" : "s"} to fix`
                  : latest.warning_count ? "No errors found" : "All checks passed"}
                {latest.warning_count > 0 && ` · ${latest.warning_count} item${latest.warning_count === 1 ? "" : "s"} to review`}
              </strong>
              <span className="small">
                {latest.docs_scanned} file(s) read · {latest.matches.length} check(s) passed
                {latest.duration_ms != null && <> · took {secs(latest.duration_ms)}</>} · {fmt(latest.run_at)}
              </span>
            </div>
            {[...latest.issues].sort((a, b) => Number(b.severity === "error") - Number(a.severity === "error")).map((i, k) => (
              <div key={k} className={"finding " + i.severity}>
                <strong><span className="tag">{i.severity === "error" ? "Fix" : "Review"}</span> {checkLabel(i.check)}</strong>
                <div>{i.message}</div>
                {i.values?.length > 0 && (
                  <ul>{i.values.map((v, n) => <li key={n}><span className="muted">{prettySource(v.source)}:</span> {show(v.value)}</li>)}</ul>
                )}
              </div>
            ))}
            {latest.matches.length > 0 && (
              <details>
                <summary>Show the {latest.matches.length} check(s) that passed</summary>
                <ul>
                  {latest.matches.map((m, k) => (
                    <li key={k}><strong>{checkLabel(m.check)}</strong>: {show(m.value)} <span className="muted small">({m.sources.map(prettySource).join("; ")})</span></li>
                  ))}
                </ul>
              </details>
            )}
          </>
        )}
      </section>

      <BillingSection job={job} role={role} termsDays={job.clients?.payment_terms_days ?? 30} onJobSaved={load} />

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

      {role === "owner" && <button className="danger" disabled={!!busy} onClick={deleteJob}>Delete shipment</button>}
      {confirming && (
        <ConfirmChanges title={`Save changes to ${job.job_no}?`} lines={confirming} warnings={dupes} busy={busy === "save"}
          onConfirm={save} onCancel={() => setConfirming(null)} />
      )}
    </>
  );
}

type Row = [string, ReactNode];
/** One numbered group of the project details. Empty values show as a dash. */
/** One section of the shipment's details. Only what has been filled in is shown, so nothing repeats as an empty line. */
function Group({ title, rows }: { title: string; rows: Row[] }) {
  const filled = rows.filter(([, v]) => !(v == null || v === "" || v === false));
  return (
    <div className="detail-group">
      <h3>{title}</h3>
      <dl className="details">
        {filled.length === 0 ? <div className="pair muted"><dd>Nothing entered yet</dd></div>
          : filled.map(([k, v]) => <div key={k} className="pair"><dt>{k}</dt><dd>{v}</dd></div>)}
      </dl>
    </div>
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
