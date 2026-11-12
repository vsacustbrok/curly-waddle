// Owner-only: who may sign up, backups, and the record of who changed what.
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { supabase } from "../lib/supabase";
import { ROLES, pretty, type Role } from "../lib/types";

type Invite = { email: string; role: Role; created_at: string };
type Backup = { id: number; created_at: string; size_bytes: number };
type Audit = {
  id: number; at: string; user_email: string | null; table_name: string; record_id: string | null;
  action: string; old_data: Record<string, unknown> | null; new_data: Record<string, unknown> | null;
};

const fmt = (iso: string) => new Date(iso).toLocaleString();
const kb = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);
const TABLE_LABEL: Record<string, string> = {
  jobs: "Shipment", clients: "Client", profiles: "Team member", job_documents: "Document", invites: "Invitation",
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
  const name = d.job_no ?? d.name ?? d.file_name ?? d.email ?? a.record_id ?? "";
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

  const load = async () => {
    const [i, b, a] = await Promise.all([
      supabase.from("invites").select("email, role, created_at").order("created_at", { ascending: false }),
      supabase.from("backups").select("id, created_at, size_bytes").order("id", { ascending: false }),
      supabase.from("audit_log").select("*").order("id", { ascending: false }).limit(300),
    ]);
    const failed = i.error ?? b.error ?? a.error;
    if (failed) setError(failed.message);
    setInvites((i.data as Invite[]) ?? []);
    setBackups((b.data as Backup[]) ?? []);
    setAudit((a.data as Audit[]) ?? []);
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
          Download one regularly and keep it somewhere safe outside this system. The uploaded files themselves (PDFs and images) are not in the backup.
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
