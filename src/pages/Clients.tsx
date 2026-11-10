import { useEffect, useState, type FormEvent } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { canEditClients, type Client } from "../lib/types";

const blank = { name: "", tin: "", address: "", contact_person: "", email: "", phone: "" };
type Form = typeof blank;
const FIELDS: [keyof Form, string][] = [
  ["name", "Name"], ["tin", "TIN"], ["contact_person", "Contact person"], ["email", "Email"], ["phone", "Phone"], ["address", "Address"],
];

export default function Clients() {
  const { profile } = useAuth();
  const role = profile!.role;
  const [clients, setClients] = useState<Client[]>([]);
  const [form, setForm] = useState<Form>(blank);
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState("");

  const load = () => supabase.from("clients").select("*").order("name").then(({ data, error }) => {
    if (error) setError(error.message);
    setClients((data as Client[]) ?? []);
  });
  useEffect(() => { load(); }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    const row = Object.fromEntries(Object.entries(form).map(([k, v]) => [k, v.trim() === "" ? null : v.trim()]));
    const res = editing
      ? await supabase.from("clients").update(row).eq("id", editing)
      : await supabase.from("clients").insert(row);
    if (res.error) { setError(res.error.message); return; }
    setForm(blank);
    setEditing(null);
    load();
  }

  async function remove(c: Client) {
    if (!confirm(`Delete client ${c.name}?`)) return;
    const { error } = await supabase.from("clients").delete().eq("id", c.id);
    if (error) setError(error.message.includes("foreign key") ? `${c.name} has jobs and cannot be deleted.` : error.message);
    load();
  }

  return (
    <>
      <h1>Clients</h1>
      {error && <p className="error">{error}</p>}
      {canEditClients(role) && (
        <form className="card" onSubmit={submit}>
          <h2>{editing ? "Edit client" : "Add client"}</h2>
          <div className="grid">
            {FIELDS.map(([k, label]) => (
              <label key={k} className={k === "address" ? "wide" : ""}>{label}
                <input value={form[k]} required={k === "name"} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
              </label>
            ))}
          </div>
          <div className="row">
            <button>{editing ? "Save" : "Add client"}</button>
            {editing && <button type="button" className="ghost" onClick={() => { setEditing(null); setForm(blank); }}>Cancel</button>}
          </div>
        </form>
      )}
      <section className="card">
        {clients.length === 0 ? <p className="muted">No clients yet.</p> : (
          <table>
            <thead><tr><th>Name</th><th>TIN</th><th>Contact</th><th>Email</th><th>Phone</th><th></th></tr></thead>
            <tbody>
              {clients.map((c) => (
                <tr key={c.id}>
                  <td>{c.name}</td><td>{c.tin}</td><td>{c.contact_person}</td><td>{c.email}</td><td>{c.phone}</td>
                  <td className="right">
                    {canEditClients(role) && (
                      <button className="link" onClick={() => {
                        setEditing(c.id);
                        setForm({ name: c.name, tin: c.tin ?? "", address: c.address ?? "", contact_person: c.contact_person ?? "", email: c.email ?? "", phone: c.phone ?? "" });
                        window.scrollTo(0, 0);
                      }}>Edit</button>
                    )}
                    {role === "owner" && <button className="link danger-text" onClick={() => remove(c)}>Delete</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
