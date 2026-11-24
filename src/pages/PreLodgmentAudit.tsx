// Pre-Lodgment Audit: before an entry is lodged with the BOC, check the shipment's documents in three
// steps (upload, AI audit and cross-check, broker sign-off and export) with a traffic light anyone can
// read at a glance. The checks run in the scan-job function; the sign-off is enforced by the database.
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { fetchAll, supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { canEditJobs, checkLabel, DOC_LABEL, pretty, prettySource, type Issue, type Job, type JobDocument, type ScanResult } from "../lib/types";
import { nameScreenshot, runScan, uploadDocs } from "../lib/docs";
import {
  CURRENCIES, PORTS, REQUIRED_CHOICES, STAGES, VASPS, downloadText, dutiableValue, exportRecord, partsOf, stageOf, toCsv, type Line,
} from "../lib/audit";
import { money } from "../lib/billing";
import { PermitBanner } from "./PermitBanner";

type Light = "red" | "yellow" | "green";
type Review = { id: number; issue_key: string; reason: string; reviewed_by_name: string | null; reviewed_at: string };
type Approval = { id: number; scan_id: string; approved_by_name: string | null; approved_at: string };
const LIGHT_TEXT: Record<Light, string> = {
  red: "Critical problem: do not lodge",
  yellow: "Review needed before lodging",
  green: "Ready for BOC lodgment",
};
const LIGHT_ICON: Record<Light, string> = { red: "🔴", yellow: "🟡", green: "🟢" };
const keyOf = (i: Issue) => i.key ?? `${i.check}:${i.message}`;

export default function PreLodgmentAudit() {
  const { id } = useParams();
  return id ? <AuditShipment id={id} /> : <AuditList />;
}

// ---------- list of shipments waiting to be lodged ----------

type ListRow = Job & { scan_results?: Pick<ScanResult, "id" | "light" | "run_at">[]; lodgment_approvals?: Approval[] };

function AuditList() {
  const [rows, setRows] = useState<ListRow[]>([]);
  const [filter, setFilter] = useState<"" | Light | "approved" | "none">("");
  const [q, setQ] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    fetchAll<ListRow>((a, b) => supabase.from("jobs")
      .select("id, job_no, status, eta, bl_awb_no, item_description, clients(name), scan_results(id, light, run_at), lodgment_approvals(id, scan_id, approved_by_name, approved_at)")
      .eq("status", "pre_arrival")
      .order("run_at", { referencedTable: "scan_results", ascending: false }).limit(1, { referencedTable: "scan_results" })
      .order("approved_at", { referencedTable: "lodgment_approvals", ascending: false }).limit(1, { referencedTable: "lodgment_approvals" })
      .order("eta", { ascending: true, nullsFirst: false }).range(a, b) as never)
      .then((r) => { setRows(r); setLoading(false); }, (e: Error) => { setError(e.message); setLoading(false); });
  }, []);

  const stateOf = (r: ListRow): Light | "approved" | "none" => {
    const s = r.scan_results?.[0];
    if (!s) return "none";
    if (r.lodgment_approvals?.[0]?.scan_id === s.id) return "approved";
    return (s.light as Light) ?? "none";
  };
  const needle = q.trim().toLowerCase();
  const shown = rows.filter((r) => (!filter || stateOf(r) === filter)
    && (!needle || [r.job_no, r.clients?.name, r.bl_awb_no, r.item_description].some((v) => (v ?? "").toLowerCase().includes(needle))));
  const count = (s: string) => rows.filter((r) => stateOf(r) === s).length;

  async function openByPn(e: FormEvent) {
    e.preventDefault();
    const pn = q.trim();
    if (!pn) return;
    const { data } = await supabase.from("jobs").select("id").ilike("job_no", pn).limit(1).maybeSingle();
    if (data) navigate(`/pre-lodgment-audit/${data.id}`);
    else setError(`No shipment with PN ${pn}.`);
  }

  return (
    <>
      <h1>Pre-Lodgment Audit</h1>
      <p className="muted">Check a shipment's documents before lodging the entry with the BOC. Pick a shipment that has not been lodged yet, or type any PN.</p>
      {error && <p className="error">{error}</p>}
      <section className="card">
        <form className="row wrap" onSubmit={openByPn}>
          <input type="search" value={q} onChange={(e) => { setQ(e.target.value); setError(""); }} placeholder="Search PN, client, BL or item" aria-label="Search" style={{ flex: 1, minWidth: 220 }} />
          <button className="ghost">Open PN</button>
        </form>
        <div className="row wrap audit-filters">
          {([["", `All ${rows.length}`], ["red", `🔴 Do not lodge ${count("red")}`], ["yellow", `🟡 Review ${count("yellow")}`],
            ["green", `🟢 Ready ${count("green")}`], ["approved", `✔ Approved ${count("approved")}`], ["none", `Not audited ${count("none")}`]] as const)
            .map(([k, label]) => <button key={k} type="button" className={"chip" + (filter === k ? " on" : "")} onClick={() => setFilter(k)}>{label}</button>)}
        </div>
        {loading ? <p className="muted">Loading…</p> : shown.length === 0 ? <p className="muted">No shipments here.</p> : (
          <div className="table-scroll">
            <table>
              <thead><tr><th>Audit</th><th>PN</th><th>Client</th><th>BL / AWB</th><th>Item</th><th>ETA</th></tr></thead>
              <tbody>
                {shown.map((r) => {
                  const s = stateOf(r);
                  return (
                    <tr key={r.id} className="clickable" onClick={() => navigate(`/pre-lodgment-audit/${r.id}`)}>
                      <td className="nowrap"><span className={"light-pill " + s}>{s === "approved" ? "✔ Approved" : s === "none" ? "Not audited" : `${LIGHT_ICON[s]} ${LIGHT_TEXT[s]}`}</span></td>
                      <td className="nowrap"><Link to={`/pre-lodgment-audit/${r.id}`} onClick={(e) => e.stopPropagation()}>{r.job_no}</Link></td>
                      <td>{r.clients?.name}</td><td>{r.bl_awb_no}</td><td className="clip">{r.item_description}</td><td className="nowrap">{r.eta}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

// ---------- one shipment ----------

function AuditShipment({ id }: { id: string }) {
  const { profile } = useAuth();
  const role = profile!.role;
  const broker = !!profile?.licensed_broker && role !== "rider" && role !== "pending";
  const editable = canEditJobs(role);
  const [step, setStep] = useState(1);
  const [job, setJob] = useState<Job | null>(null);
  const [docs, setDocs] = useState<JobDocument[]>([]);
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [approval, setApproval] = useState<Approval | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState<Issue | null>(null);

  const load = useCallback(async () => {
    const [j, d, s, r, a, l] = await Promise.all([
      supabase.from("jobs").select("*, clients(name, tin, address)").eq("id", id).maybeSingle(),
      supabase.from("job_documents").select("*").eq("job_id", id).order("uploaded_at"),
      supabase.from("scan_results").select("*").eq("job_id", id).order("run_at", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("audit_reviews").select("id, issue_key, reason, reviewed_by_name, reviewed_at").eq("job_id", id),
      supabase.from("lodgment_approvals").select("id, scan_id, approved_by_name, approved_at").eq("job_id", id).order("approved_at", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("audit_line_items").select("description, hs_code, quantity, unit_price, amount, currency, file_name").eq("job_id", id).order("file_name").order("line_no"),
    ]);
    setError(j.error?.message ?? d.error?.message ?? s.error?.message ?? "");
    setJob(j.data as Job | null);
    setDocs((d.data as JobDocument[]) ?? []);
    setScan(s.data as ScanResult | null);
    setReviews((r.data as Review[]) ?? []);
    setApproval(a.data as Approval | null);
    setLines((l.data as Line[]) ?? []);
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const reviewed = useMemo(() => new Map(reviews.map((r) => [r.issue_key, r])), [reviews]);
  const issues = scan?.issues ?? [];
  const errors = issues.filter((i) => i.severity === "error");
  const warnings = issues.filter((i) => i.severity === "warning");
  const openWarnings = warnings.filter((i) => !reviewed.has(keyOf(i)));
  // Documents changed since the last audit: uploaded or read after it ran.
  const stale = !!scan && docs.some((d) => d.uploaded_at > scan.run_at || (d.extracted_at ?? "") > scan.run_at);
  const unread = docs.filter((d) => !d.extracted && !d.extract_error).length;
  const light: Light | null = !scan ? null : errors.length ? "red" : openWarnings.length ? "yellow" : "green";
  const approved = !!approval && !!scan && approval.scan_id === scan.id && !stale;

  if (!job) return <p className="muted">{error || "Loading…"}</p>;

  const run = async (label: string, fn: () => Promise<string | undefined | null | void>) => {
    setBusy(label); setError(""); setNotice("");
    try { const e = await fn(); if (e) setError(e); } catch (e) { setError((e as Error).message); }
    setBusy(null);
  };

  async function upload(files: File[]) {
    if (!files.length) return;
    await run("upload", async () => {
      const { uploaded, problems } = await uploadDocs(job!.id, files.map(nameScreenshot), "other", profile!.id);
      await load();
      if (uploaded) setNotice(`${uploaded} file${uploaded === 1 ? "" : "s"} added. The type of each document is worked out when the audit runs.`);
      return problems.join("\n") || undefined;
    });
  }
  async function audit(force = false) {
    await run("audit", async () => {
      const out = await runScan(job!.id, force);
      await load();
      if (out.error) return out.error;
      setStep(2);
      if (out.filled.length) setNotice(`Filled in from the documents: ${out.filled.join(", ")}.`);
    });
  }

  return (
    <>
      <p className="no-print"><Link to="/pre-lodgment-audit">← All shipments to audit</Link></p>
      <PermitBanner clientId={job.client_id} />
      <div className="audit-head">
        <div>
          <h1>Pre-Lodgment Audit · {job.job_no}</h1>
          <p className="muted">{job.clients?.name}{job.port_of_entry ? ` · ${job.port_of_entry}` : ""}{job.vasp ? ` · VASP: ${job.vasp}` : ""} · <Link to={`/jobs/${job.id}`}>Open shipment</Link></p>
        </div>
        <span className={"light-pill big " + (approved ? "approved" : light ?? "none")} role="status">
          {approved ? "✔ Approved for BOC lodgment" : light ? `${LIGHT_ICON[light]} ${LIGHT_TEXT[light]}` : "Not audited yet"}
        </span>
      </div>

      <nav className="steps" aria-label="Audit steps">
        {["Upload documents", "AI audit & cross-check", "Broker sign-off & export"].map((label, i) => (
          <button key={label} type="button" className={step === i + 1 ? "on" : ""} aria-current={step === i + 1 ? "step" : undefined} onClick={() => setStep(i + 1)}>
            <span className="num">{i + 1}</span>{label}
          </button>
        ))}
      </nav>

      {error && <p className="error" role="alert" style={{ whiteSpace: "pre-line" }}>{error}</p>}
      {notice && <p className="ok-text" role="status">{notice}</p>}
      {stale && <p className="warn-text">Documents changed since the last audit. Run the audit again before signing off.</p>}

      {step === 1 && <StepUpload job={job} docs={docs} editable={editable} busy={busy} upload={upload} onSaved={load} audit={() => audit(false)} unread={unread} />}
      {step === 2 && (
        <StepAudit scan={scan} issues={issues} reviewed={reviewed} busy={busy} audit={audit} openIssue={setOpen} light={light}
          next={() => setStep(3)} />
      )}
      {step === 3 && (
        <StepSignOff job={job} docs={docs} scan={scan} warnings={warnings} errors={errors} reviewed={reviewed} broker={broker} stale={stale}
          approved={approved} approval={approval} light={light} lines={lines} busy={busy} run={run} reload={load} />
      )}

      {open && <SplitView issue={open} docs={docs} onClose={() => setOpen(null)} />}
    </>
  );
}

// ---------- step 1: upload and lodgment details ----------

function StepUpload({ job, docs, editable, busy, upload, onSaved, audit, unread }: {
  job: Job; docs: JobDocument[]; editable: boolean; busy: string | null; upload: (f: File[]) => Promise<void>;
  onSaved: () => Promise<void>; audit: () => void; unread: number;
}) {
  const [dragging, setDragging] = useState(false);
  const [form, setForm] = useState({
    port_of_entry: job.port_of_entry ?? "", vasp: job.vasp ?? "", charges_currency: job.charges_currency ?? "USD",
    freight_amount: job.freight_amount?.toString() ?? "", insurance_amount: job.insurance_amount?.toString() ?? "",
    other_charges: job.other_charges?.toString() ?? "", exchange_rate: job.exchange_rate?.toString() ?? "",
  });
  const [required, setRequired] = useState<string[]>(job.required_docs ?? []);
  const [msg, setMsg] = useState("");
  const parts = partsOf(docs);
  const dv = dutiableValue({ ...job, freight_amount: num(form.freight_amount), insurance_amount: num(form.insurance_amount), other_charges: num(form.other_charges), exchange_rate: num(form.exchange_rate), charges_currency: form.charges_currency }, parts);

  async function save(e: FormEvent) {
    e.preventDefault();
    const nums = ["freight_amount", "insurance_amount", "other_charges", "exchange_rate"] as const;
    for (const k of nums) if (form[k].trim() && !(num(form[k])! >= 0)) { setMsg("Enter amounts as numbers, e.g. 1500 or 1,500.00"); return; }
    const { error } = await supabase.from("jobs").update({
      port_of_entry: form.port_of_entry.trim() || null, vasp: form.vasp.trim() || null, charges_currency: form.charges_currency || null,
      freight_amount: num(form.freight_amount), insurance_amount: num(form.insurance_amount), other_charges: num(form.other_charges),
      exchange_rate: num(form.exchange_rate) || null, required_docs: required,
    }).eq("id", job.id);
    setMsg(error ? error.message : "Saved.");
    if (!error) await onSaved();
  }

  return (
    <>
      <section className={"card docs-drop" + (dragging ? " dragging" : "")}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); upload(Array.from(e.dataTransfer.files)); }}>
        <div className="row spread wrap">
          <h2>Shipping documents <span className="count">{docs.length}</span></h2>
          <button type="button" onClick={audit} disabled={!!busy || !docs.length}>{busy === "audit" ? "Auditing… (up to a minute)" : "Run AI audit →"}</button>
        </div>
        <label className="drop-zone">
          <input type="file" multiple accept="application/pdf,image/*,.xlsx,.xlsm" style={{ display: "none" }}
            onChange={(e) => { upload(Array.from(e.target.files ?? [])); e.target.value = ""; }} />
          <strong>{busy === "upload" ? "Uploading…" : "Drop files here, or click to choose"}</strong>
          <span className="muted small">PDF, pictures or Excel. BL, invoice, packing list, permits, certificates: the AI sorts them.</span>
        </label>
        {docs.length > 0 && (
          <table className="small">
            <thead><tr><th>File</th><th>Found inside</th><th>Status</th></tr></thead>
            <tbody>
              {docs.map((d) => {
                const found = ((d.extracted as { parts?: { doc_type_detected?: string }[] } | null)?.parts ?? []).map((p) => pretty(p.doc_type_detected ?? d.doc_type));
                return (
                  <tr key={d.id}>
                    <td>{d.file_name}</td>
                    <td>{found.length ? found.join(", ") : DOC_LABEL[d.doc_type] && d.doc_type !== "other" ? pretty(d.doc_type) : "—"}</td>
                    <td>{d.extract_error ? <span className="error">Could not read</span> : d.extracted ? <span className="ok-text">Read</span> : <span className="muted">Not read yet</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {unread > 0 && <p className="muted small">{unread} file{unread === 1 ? " is" : "s are"} not read yet: they are read when you run the audit.</p>}
      </section>

      <form className="card" onSubmit={save}>
        <h2>Lodgment details</h2>
        <fieldset disabled={!editable}>
          <div className="grid">
            <label>Port of entry<input list="audit-ports" value={form.port_of_entry} onChange={(e) => setForm({ ...form, port_of_entry: e.target.value })} placeholder="e.g. MICP" /></label>
            <label>VASP (lodged through)<input list="audit-vasps" value={form.vasp} onChange={(e) => setForm({ ...form, vasp: e.target.value })} placeholder="e.g. Intercommerce" /></label>
            <label>Currency
              <select value={form.charges_currency} onChange={(e) => setForm({ ...form, charges_currency: e.target.value })}>
                {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
              </select>
            </label>
            <label>Freight<input inputMode="decimal" value={form.freight_amount} onChange={(e) => setForm({ ...form, freight_amount: e.target.value })} placeholder="from the freight invoice" /></label>
            <label>Insurance<input inputMode="decimal" value={form.insurance_amount} onChange={(e) => setForm({ ...form, insurance_amount: e.target.value })} placeholder="from the insurance certificate" /></label>
            <label>Other charges<input inputMode="decimal" value={form.other_charges} onChange={(e) => setForm({ ...form, other_charges: e.target.value })} placeholder="if any" /></label>
            <label>BOC exchange rate (₱ per 1)<input inputMode="decimal" value={form.exchange_rate} onChange={(e) => setForm({ ...form, exchange_rate: e.target.value })} placeholder="e.g. 58.25" /></label>
          </div>
          <datalist id="audit-ports">{PORTS.map((p) => <option key={p} value={p} />)}</datalist>
          <datalist id="audit-vasps">{VASPS.map((p) => <option key={p} value={p} />)}</datalist>
          <p className="field-label">Also required for this shipment (bill of lading, invoice and packing list are always required)</p>
          <div className="check-grid">
            {REQUIRED_CHOICES.map(([k, label]) => (
              <label key={k} className="check">
                <input type="checkbox" checked={required.includes(k)} onChange={(e) => setRequired(e.target.checked ? [...required, k] : required.filter((x) => x !== k))} /> {label}
              </label>
            ))}
          </div>
        </fieldset>
        {dv && (
          <p className="dv">
            Estimated dutiable value: invoice {money(dv.invoice)} + freight {money(Number(dv.freight ?? 0))} + insurance {money(Number(dv.insurance ?? 0))}{dv.other ? ` + other ${money(Number(dv.other))}` : ""} = <strong>{dv.currency} {money(dv.total)}</strong>
            {dv.php != null && <> = <strong>₱{money(dv.php)}</strong></>}
            <span className="muted small"> (an estimate to check against the entry; duties and taxes are not computed here)</span>
          </p>
        )}
        {editable && <div className="row"><button>Save lodgment details</button>{msg && <span className={msg === "Saved." ? "ok-text" : "error"}>{msg}</span>}</div>}
        {!editable && <p className="muted small">Only the owner or a processor can change these details.</p>}
      </form>
    </>
  );
}
const num = (v: string) => (v.trim() === "" ? null : Number(v.replace(/,/g, "")));

// ---------- step 2: audit results ----------

function StepAudit({ scan, issues, reviewed, busy, audit, openIssue, light, next }: {
  scan: ScanResult | null; issues: Issue[]; reviewed: Map<string, Review>; busy: string | null; audit: (force?: boolean) => void;
  openIssue: (i: Issue) => void; light: Light | null; next: () => void;
}) {
  if (!scan) {
    return (
      <section className="card">
        <p>This shipment has not been audited yet.</p>
        <button type="button" onClick={() => audit(false)} disabled={!!busy}>{busy === "audit" ? "Auditing…" : "Run AI audit"}</button>
      </section>
    );
  }
  const byStage = STAGES.map((name, s) => ({ name, list: issues.filter((i) => stageOf(i) === s) }));
  const matches = scan.matches ?? [];
  return (
    <>
      <section className={"card audit-summary " + (light ?? "")}>
        <div className="row spread wrap">
          <div>
            <h2>{light && `${LIGHT_ICON[light]} ${LIGHT_TEXT[light]}`}</h2>
            <p className="muted small">Audited {new Date(scan.run_at).toLocaleString()} · {scan.docs_scanned} document{scan.docs_scanned === 1 ? "" : "s"} read · {scan.error_count} critical · {scan.warning_count} to review · {matches.length} checks passed</p>
          </div>
          <div className="row">
            <button type="button" className="ghost" onClick={() => audit(false)} disabled={!!busy}>{busy === "audit" ? "Auditing…" : "Run audit again"}</button>
            <button type="button" className="ghost" onClick={() => audit(true)} disabled={!!busy} title="Read every file again from the start">Re-read all files</button>
            <button type="button" onClick={next}>Go to sign-off →</button>
          </div>
        </div>
      </section>
      {byStage.map(({ name, list }, s) => (
        <section key={name} className="card">
          <h2>{s + 1 <= 4 ? `Stage ${s + 1}: ` : ""}{name} {list.length === 0 ? <span className="ok-text small">✔ no problems</span> : <span className="count">{list.length}</span>}</h2>
          {list.sort((a, b) => Number(b.severity === "error") - Number(a.severity === "error")).map((i, k) => {
            const r = reviewed.get(keyOf(i));
            return (
              <button key={k} type="button" className={"issue " + (i.severity === "error" ? "red" : r ? "done" : "yellow")} onClick={() => openIssue(i)}>
                <span className="issue-title">{i.severity === "error" ? "🔴" : r ? "✔" : "🟡"} {checkLabel(i.check)}</span>
                <span>{i.message}</span>
                {i.fix && <span className="issue-fix">What to do: {i.fix}</span>}
                {r && <span className="muted small">Reviewed by {r.reviewed_by_name}: {r.reason}</span>}
                <span className="muted small">Click to compare the documents side by side</span>
              </button>
            );
          })}
        </section>
      ))}
      {matches.length > 0 && (
        <details className="card">
          <summary><strong>Checks that passed ({matches.length})</strong></summary>
          <ul className="small">{matches.map((m, k) => <li key={k}>✔ {checkLabel(m.check)}: {String(Array.isArray(m.value) ? m.value.join(", ") : m.value)}</li>)}</ul>
        </details>
      )}
    </>
  );
}

// ---------- split view: values left, the document right ----------

function SplitView({ issue, docs, onClose }: { issue: Issue; docs: JobDocument[]; onClose: () => void }) {
  const sources = issue.values.map((v) => v.source);
  const related = docs.filter((d) => sources.some((s) => s.includes(d.file_name)));
  const [docId, setDocId] = useState(related[0]?.id ?? docs[0]?.id ?? "");
  const [url, setUrl] = useState<string | null>(null);
  const [text, setText] = useState<string | null>(null);
  const doc = docs.find((d) => d.id === docId);

  useEffect(() => {
    setUrl(null); setText(null);
    if (!doc) return;
    let live = true;
    supabase.storage.from("job-docs").createSignedUrl(doc.file_path, 600).then(async ({ data }) => {
      if (!live || !data) return;
      if (doc.mime_type === "text/csv") setText(await fetch(data.signedUrl).then((r) => r.text()).catch(() => "Could not open the file."));
      else setUrl(data.signedUrl);
    });
    return () => { live = false; };
  }, [doc]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="card modal split-modal" role="dialog" aria-modal="true" aria-label={checkLabel(issue.check)} onClick={(e) => e.stopPropagation()}>
        <div className="row spread"><h2>{issue.severity === "error" ? "🔴" : "🟡"} {checkLabel(issue.check)}</h2><button type="button" className="ghost" onClick={onClose}>Close</button></div>
        <div className="split">
          <div className="split-left">
            <p>{issue.message}</p>
            {issue.fix && <p className="issue-fix">What to do: {issue.fix}</p>}
            {issue.values.length > 0 && (
              <table className="small">
                <thead><tr><th>Where</th><th>Value found</th></tr></thead>
                <tbody>{issue.values.map((v, k) => <tr key={k}><td>{prettySource(v.source)}</td><td><strong>{fmt(v.value)}</strong></td></tr>)}</tbody>
              </table>
            )}
          </div>
          <div className="split-right">
            {docs.length > 0 && (
              <select value={docId} onChange={(e) => setDocId(e.target.value)} aria-label="Document shown">
                {docs.map((d) => <option key={d.id} value={d.id}>{related.includes(d) ? "● " : ""}{d.file_name}</option>)}
              </select>
            )}
            {!doc ? <p className="muted">No document to show.</p>
              : text != null ? <pre className="csv-view">{text}</pre>
              : !url ? <p className="muted">Opening…</p>
              : doc.mime_type?.startsWith("image/") ? <img src={url} alt={doc.file_name} />
              : <iframe src={url} title={doc.file_name} />}
          </div>
        </div>
      </div>
    </div>
  );
}
const fmt = (v: unknown) => (v == null ? "—" : Array.isArray(v) ? v.join(", ") : typeof v === "object" ? JSON.stringify(v) : String(v));

// ---------- step 3: broker sign-off and export ----------

function StepSignOff({ job, docs, scan, warnings, errors, reviewed, broker, stale, approved, approval, light, lines, busy, run, reload }: {
  job: Job; docs: JobDocument[]; scan: ScanResult | null; warnings: Issue[]; errors: Issue[]; reviewed: Map<string, Review>;
  broker: boolean; stale: boolean; approved: boolean; approval: Approval | null; light: Light | null; lines: Line[]; busy: string | null;
  run: (label: string, fn: () => Promise<string | undefined | null | void>) => Promise<void>; reload: () => Promise<void>;
}) {
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const openCount = warnings.filter((i) => !reviewed.has(keyOf(i))).length;
  const canApprove = broker && !!scan && !stale && errors.length === 0 && openCount === 0 && !approved;

  const review = (i: Issue) => run("review", async () => {
    const reason = (reasons[keyOf(i)] ?? "").trim();
    if (reason.length < 5) return "Write a short reason (at least 5 letters) before marking it reviewed.";
    const { error } = await supabase.from("audit_reviews").insert({ job_id: job.id, scan_id: scan!.id, issue_key: keyOf(i), reason });
    if (error) return error.message;
    await reload();
  });
  const undo = (r: Review) => run("review", async () => {
    const { error } = await supabase.from("audit_reviews").delete().eq("id", r.id);
    if (error) return error.message;
    await reload();
  });
  const approve = () => run("approve", async () => {
    if (!confirm(`Approve ${job.job_no} for BOC lodgment? Your name and the time will be recorded.`)) return;
    const { error } = await supabase.from("lodgment_approvals").insert({ job_id: job.id, scan_id: scan!.id });
    if (error) return error.message;
    await reload();
  });

  const record = () => exportRecord(job, docs, light, approved ? approval : null);
  const file = `${job.job_no} pre-lodgment ${approved ? "approved" : "draft"}`;
  const excel = () => run("export", async () => {
    const { default: writeExcelFile } = await import("write-excel-file/browser");
    const rec = record();
    const t = (v: unknown) => (v == null || v === "" ? null : typeof v === "number" ? { value: v, type: Number } : { value: String(v), type: String });
    const bold = (h: string) => ({ value: h, fontWeight: "bold" as const });
    const sheet1 = Object.entries(rec).map(([k, v]) => [bold(k), t(v)]);
    const lk: (keyof Line)[] = ["description", "hs_code", "quantity", "unit_price", "amount", "currency", "file_name"];
    const sheet2 = [["line_no", ...lk].map(bold), ...lines.map((l, i) => [t(i + 1), ...lk.map((k) => t(l[k]))])];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (writeExcelFile as any)([
      { data: sheet1, sheet: "Shipment", columns: [{ width: 22 }, { width: 50 }] },
      { data: sheet2, sheet: "Invoice lines", columns: [8, 50, 14, 10, 12, 14, 8, 30].map((width) => ({ width })), stickyRowsCount: 1 },
    ]).toFile(`${file}.xlsx`);
  });

  return (
    <>
      <section className="card">
        <h2>Broker sign-off</h2>
        {!broker && <p className="warn-text">Only a licensed customs broker can review warnings and approve. The owner marks brokers on the Team page.</p>}
        {stale && <p className="warn-text">The documents changed after the last audit. Run the audit again first.</p>}
        {!scan ? <p className="muted">Run the audit first (step 2).</p> : (
          <>
            {errors.length > 0 && <p className="error">🔴 {errors.length} critical problem{errors.length === 1 ? "" : "s"} must be fixed in the documents, then audited again. They cannot be overridden.</p>}
            {warnings.length === 0 && errors.length === 0 && <p className="ok-text">No warnings to review.</p>}
            {warnings.map((i) => {
              const k = keyOf(i);
              const r = reviewed.get(k);
              return (
                <div key={k} className={"review-row " + (r ? "done" : "")}>
                  <div><strong>{r ? "✔" : "🟡"} {checkLabel(i.check)}</strong><br /><span className="small">{i.message}</span></div>
                  {r ? (
                    <div className="small">Reviewed by <strong>{r.reviewed_by_name}</strong>, {new Date(r.reviewed_at).toLocaleString()}<br />Reason: {r.reason}
                      {broker && !approved && <> · <button type="button" className="link" onClick={() => undo(r)}>Undo</button></>}
                    </div>
                  ) : broker ? (
                    <div className="row">
                      <input value={reasons[k] ?? ""} onChange={(e) => setReasons({ ...reasons, [k]: e.target.value })} placeholder="Reason / verification note (required)" aria-label="Reason" style={{ flex: 1, minWidth: 200 }} />
                      <button type="button" className="ghost" disabled={!!busy} onClick={() => review(i)}>Mark reviewed</button>
                    </div>
                  ) : <span className="muted small">Waiting for a broker's review</span>}
                </div>
              );
            })}
            <div className="approve-box">
              {approved ? (
                <p className="stamp">✔ Approved for BOC lodgment by <strong>{approval!.approved_by_name}</strong> on {new Date(approval!.approved_at).toLocaleString()}</p>
              ) : (
                <>
                  <button type="button" className="approve-btn" disabled={!canApprove || !!busy} onClick={approve}>Approve for BOC lodgment</button>
                  {!canApprove && broker && <span className="muted small">
                    {stale ? "Run the audit again first." : errors.length ? "Fix the critical problems first." : openCount ? `Review the ${openCount} remaining warning${openCount === 1 ? "" : "s"} first.` : ""}
                  </span>}
                </>
              )}
            </div>
          </>
        )}
      </section>

      <section className="card">
        <div className="row spread wrap">
          <h2>Duties and taxes</h2>
          <span className="row"><Link className="button-like" to={`/duties/${job.id}`}>Compute duties and taxes →</Link><Link className="ghost-link" to={`/jobs/${job.id}/pre-sad`}>Pre-SAD draft</Link></span>
        </div>
        <p className="muted small">Opens the office computation with this shipment's invoice lines (one line per item), freight, insurance, exchange rate and containers filled in.</p>
      </section>

      <section className="card">
        <h2>Export for VASP encoding</h2>
        <p className="muted small">The shipment details and the invoice lines as read from the documents. {approved ? "Marked as approved." : "Marked as a draft until a broker approves."}</p>
        <div className="row wrap">
          <button type="button" onClick={excel} disabled={!!busy}>{busy === "export" ? "Preparing…" : "Excel (.xlsx)"}</button>
          <button type="button" className="ghost" onClick={() => downloadText(`${file}.csv`, toCsv(record(), lines), "text/csv")}>CSV</button>
          <button type="button" className="ghost" onClick={() => downloadText(`${file}.json`, JSON.stringify({ shipment: record(), invoice_lines: lines }, null, 2), "application/json")}>JSON</button>
        </div>
        {lines.length === 0 && <p className="muted small">No invoice lines were read yet; the export has the shipment details only.</p>}
      </section>
    </>
  );
}
