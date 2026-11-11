import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { PLACEHOLDER_CLIENT, type Client, type Profile } from "../lib/types";
import { MAX_FILES, fileProblem, runScan, uploadDocs } from "../lib/docs";
import JobFields, { emptyJob, toRow, type JobForm } from "./JobFields";

/** The client new shipments sit under until the consignee has been read from the documents. */
async function placeholderClientId(): Promise<string> {
  const found = await supabase.from("clients").select("id").eq("name", PLACEHOLDER_CLIENT).limit(1);
  if (found.error) throw new Error(found.error.message);
  if (found.data.length) return found.data[0].id;
  const made = await supabase.from("clients").insert({ name: PLACEHOLDER_CLIENT }).select("id").single();
  if (made.error) throw new Error(made.error.message);
  return made.data.id;
}

export default function JobNew() {
  const nav = useNavigate();
  const { profile } = useAuth();
  const [clients, setClients] = useState<Client[]>([]);
  const [staff, setStaff] = useState<Profile[]>([]);
  const [form, setForm] = useState<JobForm>(emptyJob);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [step, setStep] = useState("");

  useEffect(() => {
    supabase.from("clients").select("*").order("name").then(({ data }) => setClients((data as Client[]) ?? []));
    supabase.from("profiles").select("*").in("role", ["owner", "processor"]).order("full_name")
      .then(({ data }) => setStaff((data as Profile[]) ?? []));
  }, []);

  const fileProblems = files.map(fileProblem).filter((p): p is string => !!p);
  if (files.length > MAX_FILES) fileProblems.push(`Choose at most ${MAX_FILES} files for one shipment.`);

  async function createFromDocuments() {
    setBusy(true);
    setError("");
    try {
      setStep("Creating the shipment…");
      const client_id = await placeholderClientId();
      const job = await supabase.from("jobs").insert({ client_id }).select("id").single();
      if (job.error) throw new Error(job.error.message);

      setStep(`Uploading ${files.length} file(s)…`);
      const up = await uploadDocs(job.data.id, files, "other", profile!.id);
      if (up.uploaded === 0) {
        // Nothing to read: remove the empty shipment again (only the owner may; otherwise it stays, visibly empty).
        await supabase.from("jobs").delete().eq("id", job.data.id);
        throw new Error(`No file could be uploaded.\n${up.problems.join("\n")}`);
      }

      setStep("Reading the documents… this can take a minute or two.");
      const scan = await runScan(job.data.id, false);
      const notes = [...up.problems];
      if (scan.error) notes.push(`The documents were uploaded, but reading them failed: ${scan.error}`);
      nav(`/jobs/${job.data.id}`, { state: { filled: scan.filled, error: notes.join("\n") } });
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
      setStep("");
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const { data, error } = await supabase.from("jobs").insert(toRow(form)).select("id").single();
    setBusy(false);
    if (error) setError(error.message);
    else nav(`/jobs/${data.id}`);
  }

  return (
    <>
      <h1>New shipment</h1>
      {error && <p className="error pre">{error}</p>}
      <section className="card">
        <h2>From documents</h2>
        <p>
          Choose the shipping documents (bill of lading or airway bill, commercial invoice, packing list). The app reads
          them, fills in the shipment and its client, and cross-checks the documents. Nothing to type.
        </p>
        <div className="row">
          <input type="file" multiple accept=".pdf,.png,.jpg,.jpeg" disabled={busy}
            onChange={(e) => setFiles(Array.from(e.target.files ?? []))} />
          <button disabled={busy || files.length === 0 || fileProblems.length > 0} onClick={createFromDocuments}>
            {busy && step ? "Working…" : `Create shipment from ${files.length || "the"} file(s)`}
          </button>
        </div>
        {step && <p className="muted">{step}</p>}
        {fileProblems.map((p) => <p key={p} className="error small">{p}</p>)}
        <p className="muted small">PDF, PNG or JPG, up to 10 MB each. Several documents scanned into one PDF are fine.</p>
      </section>

      <details className="card">
        <summary>Or enter the details by hand</summary>
        <form onSubmit={submit}>
          {clients.length === 0 && <p className="muted">No clients yet. <Link to="/clients">Add a client</Link> first.</p>}
          <JobFields form={form} setForm={setForm} clients={clients} staff={staff} />
          <div className="row"><button disabled={busy || !form.client_id}>Create job</button></div>
        </form>
      </details>
    </>
  );
}
