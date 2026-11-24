// Owner-only: who may sign up, backups, and the record of who changed what.
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { supabase } from "../lib/supabase";
import { ROLES, pretty, type Role } from "../lib/types";
import { REMIND_AFTER_DAYS, copyIsDue, daysSince, readme, safeName, zipPaths, type CopyRow, type DocRow } from "../lib/offsite";

type Invite = { email: string; role: Role; created_at: string };
type Backup = { id: number; created_at: string; size_bytes: number };
type Audit = {
  id: number; at: string; user_email: string | null; table_name: string; record_id: string | null;
  action: string; old_data: Record<string, unknown> | null; new_data: Record<string, unknown> | null;
};

const fmt = (iso: string) => new Date(iso).toLocaleString();
const kb = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);
const TABLE_LABEL: Record<string, string> = {
  jobs: "Shipment", clients: "Client", profiles: "Team member", job_documents: "Document", invites: "Invitation", job_notes: "Status note", charges: "Charge", payments: "Payment",
};
const ACTION_LABEL: Record<string, string> = { INSERT: "Added", UPDATE: "Changed", DELETE: "Deleted" };

function saveFile(name: string, data: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 1)], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** What the row is, in a few words. */
function subject(a: Audit): string {
  const d = a.new_data ?? a.old_data ?? {};
  const name = d.job_no ?? d.name ?? d.file_name ?? d.email ?? (typeof d.body === "string" ? `"${d.body.slice(0, 40)}"` : null) ?? a.record_id ?? "";
  return `${TABLE_LABEL[a.table_name] ?? pretty(a.table_name)} ${name}`.trim();
}
/** For a change, the fields that differ, as "field: old → new". */
function changes(a: Audit): string {
  if (a.action !== "UPDATE" || !a.old_data || !a.new_data) return "";
  const show = (v: unknown) => (v == null || v === "" ? "empty" : typeof v === "object" ? JSON.stringify(v) : String(v));
  return Object.keys(a.new_data)
    .filter((k) => k !== "updated_at" && JSON.stringify(a.old_data![k]) !== JSON.stringify(a.new_data![k]))
    .map((k) => `${pretty(k)}: ${show(a.old_data![k])} → ${show(a.new_data![k])}`)
    .join("; ");
}

export default function Security() {
  const [invites, setInvites] = useState<Invite[]>([]);
  const [backups, setBackups] = useState<Backup[]>([]);
  const [audit, setAudit] = useState<Audit[]>([]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("processor");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [q, setQ] = useState("");
  const [copies, setCopies] = useState<CopyRow[]>([]);
  const [onlyNew, setOnlyNew] = useState(false);
  const [progress, setProgress] = useState("");

  const load = async () => {
    const [i, b, a, c] = await Promise.all([
      supabase.from("invites").select("email, role, created_at").order("created_at", { ascending: false }),
      supabase.from("backups").select("id, created_at, size_bytes").order("id", { ascending: false }),
      supabase.from("audit_log").select("*").order("id", { ascending: false }).limit(300),
      supabase.from("offsite_copies").select("id, made_at, files_included, bytes, only_new_since").order("id", { ascending: false }).limit(10),
    ]);
    const failed = i.error ?? b.error ?? a.error ?? c.error;
    if (failed) setError(failed.message);
    setInvites((i.data as Invite[]) ?? []);
    setBackups((b.data as Backup[]) ?? []);
    setAudit((a.data as Audit[]) ?? []);
    setCopies((c.data as CopyRow[]) ?? []);
  };
  useEffect(() => { load(); }, []);

  async function invite(e: FormEvent) {
    e.preventDefault();
    setError("");
    const { error } = await supabase.from("invites").insert({ email: email.trim().toLowerCase(), role });
    if (error) setError(error.code === "23505" ? `${email.trim()} is already invited.` : error.message);
    else setEmail("");
    load();
  }
  async function uninvite(i: Invite) {
    if (!confirm(`Remove the invitation for ${i.email}? If they already have an account it stays; change their role on the Team page.`)) return;
    const { error } = await supabase.from("invites").delete().eq("email", i.email);
    if (error) setError(error.message);
    load();
  }

  async function download(b: Backup) {
    setBusy(`backup-${b.id}`);
    setError("");
    const { data, error } = await supabase.from("backups").select("data").eq("id", b.id).single();
    if (error) setError(error.message);
    else saveFile(`VSA backup ${b.created_at.slice(0, 10)}.json`, data.data);
    setBusy("");
  }

  /** One ZIP: the latest nightly backup plus the uploaded documents, saved to this computer. */
  async function offsiteCopy() {
    setError("");
    setBusy("offsite");
    try {
      const since = onlyNew && copies[0] ? copies[0].made_at : null;
      setProgress("Getting the latest backup…");
      const latest = backups[0];
      const b = latest ? await supabase.from("backups").select("data").eq("id", latest.id).single() : null;
      if (b?.error) throw new Error(b.error.message);
      let docQuery = supabase.from("job_documents").select("id, file_path, file_name, size_bytes, uploaded_at, jobs(job_no)").order("uploaded_at");
      if (since) docQuery = docQuery.gt("uploaded_at", since);
      const d = await docQuery;
      if (d.error) throw new Error(d.error.message);
      const docs = (d.data as unknown as DocRow[]) ?? [];
      const paths = zipPaths(docs);
      const { zip, strToU8 } = await import("fflate");
      const entries: Record<string, [Uint8Array, { level: 0 | 6 }]> = {};
      if (b) entries["backup.json"] = [strToU8(JSON.stringify(b.data.data, null, 1)), { level: 6 }];
      const missing: string[] = [];
      let bytes = 0;
      for (const [n, doc] of docs.entries()) {
        setProgress(`Adding document ${n + 1} of ${docs.length}…`);
        const f = await supabase.storage.from("job-docs").download(doc.file_path);
        if (f.error || !f.data) { missing.push(paths.get(doc.id)!); continue; }
        const u8 = new Uint8Array(await f.data.arrayBuffer());
        bytes += u8.length;
        entries[paths.get(doc.id)!] = [u8, { level: 0 }];
      }
      // Rider photos (receipts, signed receiving copies): rider photos/<date> <rider>/...
      let photoQuery = supabase.from("rider_photos").select("id, kind, file_path, uploaded_at, rider_logs(log_date, riders(name))").order("id");
      if (since) photoQuery = photoQuery.gt("uploaded_at", since);
      const ph = await photoQuery;
      if (ph.error) throw new Error(ph.error.message);
      const photos = (ph.data ?? []) as unknown as { id: number; kind: string; file_path: string; rider_logs: { log_date: string; riders: { name: string } | null } | null }[];
      let photosIn = 0;
      for (const [n, photo] of photos.entries()) {
        setProgress(`Adding rider photo ${n + 1} of ${photos.length}…`);
        const name = `rider photos/${safeName(`${photo.rider_logs?.log_date ?? ""} ${photo.rider_logs?.riders?.name ?? ""}`)}/${photo.kind} ${photo.id}.jpg`;
        const f = await supabase.storage.from("rider-files").download(photo.file_path);
        if (f.error || !f.data) { missing.push(name); continue; }
        const u8 = new Uint8Array(await f.data.arrayBuffer());
        bytes += u8.length; photosIn++;
        entries[name] = [u8, { level: 0 }];
      }
      const made = new Date();
      entries["READ ME.txt"] = [strToU8(readme(made, latest?.created_at ?? null, docs.length - missing.filter((m) => m.startsWith("documents/")).length, missing, since, photosIn)), { level: 6 }];
      setProgress("Packing the ZIP file…");
      const out = await new Promise<Uint8Array>((ok, fail) => zip(entries, (err, data) => (err ? fail(err) : ok(data))));
      const url = URL.createObjectURL(new Blob([out as BlobPart], { type: "application/zip" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `VSA off-site copy ${made.toISOString().slice(0, 10)}${since ? " (new files)" : ""}.zip`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      const { data: u } = await supabase.auth.getUser();
      const rec = await supabase.from("offsite_copies").insert({
        made_by: u.user?.id, backup_id: latest?.id ?? null, files_included: docs.length + photosIn - missing.filter((m) => m.startsWith("documents/")).length, bytes, only_new_since: since,
      });
      if (rec.error) throw new Error(rec.error.message);
      if (missing.length) setError(`${missing.length} file(s) could not be downloaded and are listed in "READ ME.txt" inside the ZIP. Try again later.`);
      await load();
    } catch (e) {
      setError(`The off-site copy was not finished: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy("");
      setProgress("");
    }
  }
  const lastCopy = copies[0]?.made_at ?? null;
  const ago = daysSince(lastCopy);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return audit;
    return audit.filter((a) => `${a.user_email ?? ""} ${subject(a)} ${ACTION_LABEL[a.action] ?? a.action} ${changes(a)}`.toLowerCase().includes(needle));
  }, [audit, q]);

  return (
    <>
      <h1>Security</h1>
      {error && <p className="error">{error}</p>}

      <section className="card">
        <h2>Who may create an account</h2>
        <p className="muted small">
          Only the emails listed here can sign up. Each person signs up themselves with their own password and starts with the role you choose.
        </p>
        <form className="row" onSubmit={invite}>
          <input type="email" required placeholder="name@example.com" value={email} onChange={(e) => setEmail(e.target.value)} aria-label="Email to invite" />
          <select value={role} onChange={(e) => setRole(e.target.value as Role)} aria-label="Role">
            {ROLES.filter((r) => r !== "pending").map((r) => <option key={r} value={r}>{pretty(r)}</option>)}
          </select>
          <button>Invite</button>
        </form>
        {invites.length === 0 ? <p className="muted">Nobody is invited, so nobody new can sign up.</p> : (
          <table>
            <thead><tr><th>Email</th><th>Starts as</th><th>Invited</th><th></th></tr></thead>
            <tbody>
              {invites.map((i) => (
                <tr key={i.email}>
                  <td>{i.email}</td><td>{pretty(i.role)}</td><td className="muted small">{fmt(i.created_at)}</td>
                  <td className="right"><button className="link danger-text" onClick={() => uninvite(i)}>Remove</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="card">
        <h2>Backups</h2>
        <p className="muted small">
          A copy of all shipments, clients, document readings, team and history is saved every night at 1:00 AM, and the last 14 are kept.
          The uploaded files themselves (PDFs and images) are not in these; the off-site copy below has both.
        </p>
        {backups.length === 0 ? <p className="muted">No backup has been made yet.</p> : (
          <table>
            <thead><tr><th>Made</th><th>Size</th><th></th></tr></thead>
            <tbody>
              {backups.map((b) => (
                <tr key={b.id}>
                  <td>{fmt(b.created_at)}</td><td>{kb(b.size_bytes)}</td>
                  <td className="right">
                    <button className="link" disabled={!!busy} onClick={() => download(b)}>{busy === `backup-${b.id}` ? "Preparing…" : "Download"}</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="card">
        <h2>Off-site copy</h2>
        <p className="muted small">
          The nightly backups above are stored in the same place as the system. Once a week, save a full copy to somewhere else:
          a USB drive, an external disk or your own Google Drive. It is one ZIP file with the latest backup and every uploaded document, one folder per PN.
        </p>
        <p className={copyIsDue(lastCopy) ? "warn" : "ok"} role="status">
          {ago == null ? "No off-site copy has been made yet." : `Last off-site copy: ${fmt(lastCopy!)} (${ago === 0 ? "today" : ago === 1 ? "yesterday" : `${ago} days ago`}).`}
          {copyIsDue(lastCopy) && ` Please make one now; the reminder shows after ${REMIND_AFTER_DAYS} days.`}
        </p>
        <div className="row wrap">
          <button type="button" disabled={!!busy} onClick={offsiteCopy}>{busy === "offsite" ? progress || "Preparing…" : "Save off-site copy (ZIP)"}</button>
          {copies.length > 0 && (
            <label className="check"><input type="checkbox" checked={onlyNew} disabled={!!busy} onChange={(e) => setOnlyNew(e.target.checked)} /> Only documents added since the last copy (smaller file)</label>
          )}
        </div>
        {copies.length > 0 && (
          <div className="table-scroll"><table className="small">
            <thead><tr><th>Made</th><th>Documents</th><th>Size of documents</th><th>Kind</th></tr></thead>
            <tbody>
              {copies.map((c) => (
                <tr key={c.id}><td>{fmt(c.made_at)}</td><td>{c.files_included}</td><td>{kb(c.bytes)}</td><td>{c.only_new_since ? "New documents only" : "Full copy"}</td></tr>
              ))}
            </tbody>
          </table></div>
        )}
      </section>

      <section className="card">
        <div className="row spread">
          <h2>Activity</h2>
          <input placeholder="Search person, PN, client…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <p className="muted small">The latest 300 changes. "System" means the document checker or an automatic step.</p>
        {shown.length === 0 ? <p className="muted">Nothing to show.</p> : (
          <table>
            <thead><tr><th>When</th><th>Who</th><th>What</th><th>Details</th></tr></thead>
            <tbody>
              {shown.map((a) => (
                <tr key={a.id}>
                  <td className="muted small nowrap">{fmt(a.at)}</td>
                  <td>{a.user_email ?? "System"}</td>
                  <td>{ACTION_LABEL[a.action] ?? a.action} · {subject(a)}</td>
                  <td className="small">{changes(a)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
