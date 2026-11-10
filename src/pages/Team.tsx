import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { ROLES, pretty, type Profile, type Role } from "../lib/types";

type Audit = { id: number; at: string; user_email: string | null; table_name: string; action: string; record_id: string | null };

export default function Team() {
  const { profile, reload } = useAuth();
  const [people, setPeople] = useState<Profile[]>([]);
  const [audit, setAudit] = useState<Audit[]>([]);
  const [error, setError] = useState("");

  const load = () => {
    supabase.from("profiles").select("*").order("created_at").then(({ data }) => setPeople((data as Profile[]) ?? []));
    supabase.from("audit_log").select("id, at, user_email, table_name, action, record_id").order("at", { ascending: false }).limit(50)
      .then(({ data }) => setAudit((data as Audit[]) ?? []));
  };
  useEffect(load, []);

  async function setRole(p: Profile, role: Role) {
    setError("");
    const { error } = await supabase.from("profiles").update({ role }).eq("id", p.id);
    if (error) setError(error.message);
    if (p.id === profile!.id) await reload();
    load();
  }

  return (
    <>
      <h1>Team</h1>
      {error && <p className="error">{error}</p>}
      <section className="card">
        <p className="muted small">New sign-ups appear here as Pending until you give them a role.</p>
        <table>
          <thead><tr><th>Name</th><th>Email</th><th>Role</th></tr></thead>
          <tbody>
            {people.map((p) => (
              <tr key={p.id} className={p.role === "pending" ? "highlight" : ""}>
                <td>{p.full_name || "—"}</td><td>{p.email}</td>
                <td>
                  <select value={p.role} onChange={(e) => setRole(p, e.target.value as Role)}>
                    {ROLES.map((r) => <option key={r} value={r}>{pretty(r)}</option>)}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section className="card">
        <h2>Recent activity</h2>
        <table>
          <thead><tr><th>When</th><th>Who</th><th>What</th></tr></thead>
          <tbody>
            {audit.map((a) => (
              <tr key={a.id}>
                <td className="muted small">{new Date(a.at).toLocaleString()}</td>
                <td>{a.user_email ?? "system"}</td>
                <td>{a.action.toLowerCase()} {pretty(a.table_name).toLowerCase()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}
