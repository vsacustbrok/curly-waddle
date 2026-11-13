import { useEffect, useState, type FormEvent } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { canEditClients, type Client } from "../lib/types";

const blank = { name: "", tin: "", address: "", contact_person: "", email: "", phone: "", payment_terms_days: "30" };
type Form = typeof blank;
const FIELDS: [keyof Form, string][] = [
  ["name", "Name"], ["tin", "TIN"], ["contact_person", "Contact person"], ["email", "Email"], ["phone", "Phone"], ["payment_terms_days", "Payment terms (days)"], ["address", "Address"],
];

export default function Clients() {
  const { profile } = useAuth();
  const role = profile!.role;
  const [clients, setClients] = useState<Client[]>([]);
  const [form, setForm] = useState<Form>(blank);
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [mergeFrom, setMergeFrom] = useState<Client | null>(null);
  const [mergeInto, setMergeInto] = useState("");
  const [busy, setBusy] = useState(false);

  const load = () => supabase.from("clients").select("*").order("name").then(({ data, error }) => {
    if (error) setError(error.message);
    setClients((data as Client[]) ?? []);
  });
  useEffect(() => { load(); }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    const row: Record<string, unknown> = Object.fromEntries(Object.entries(form).map(([k, v]) => [k, v.trim() === "" ? null : v.trim()]));
    const terms = Number(form.payment_terms_days || 30);
    if (!Number.isInteger(terms) || terms < 0 || terms > 365) { setError("Payment terms must be a whole number of days, 0 to 365."); return; }
    row.payment_terms_days = terms;
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
    if (error) setError(error.message.includes("foreign key") ? `${c.name} has shipments and cannot be deleted.` : error.message);
    load();
  }

  /** Moves every shipment of one client to another and removes the first (for misspelt duplicates). */
  async function merge() {
    if (!mergeFrom || !mergeInto) return;
    setBusy(true); setError(""); setNotice("");
    const keep = clients.find((c) => c.id === mergeInto)!;
    const { data, error } = await supabase.rpc("merge_clients", { from_id: mergeFrom.id, into_id: mergeInto });
    setBusy(false);
    if (error) { setError(error.message); return; }
    setNotice(`${mergeFrom.name} was merged into ${keep.name}: ${data ?? 0} shipment(s) moved.`);
    setMergeFrom(null); setMergeInto("");
    load();
  }

  return (
    <>
      <h1>Clients</h1>
      {error && <p className="error">{error}</p>}
      {notice && <p className="ok" role="status">{notice}</p>}
      {mergeFrom && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Merge client">
          <div className="card modal">
            <h2>Merge {mergeFrom.name}</h2>
            <p>All shipments of <strong>{mergeFrom.name}</strong> move to the client you pick, and {mergeFrom.name} is removed. This cannot be undone.</p>
            <label>Keep this client
              <select value={mergeInto} onChange={(e) => setMergeInto(e.target.value)} aria-label="Client to keep">
                <option value="">Select…</option>
                {clients.filter((c) => c.id !== mergeFrom.id).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
            <div className="row">
              <button type="button" onClick={merge} disabled={busy || !mergeInto}>{busy ? "Merging…" : "Merge"}</button>
              <button type="button" className="ghost" onClick={() => { setMergeFrom(null); setMergeInto(""); }}>Cancel</button>
            </div>
          </div>
        </div>
      )}
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
      {role === "owner" && <p className="muted small">Same client saved under two spellings? Use “Merge into…” on the misspelt one to move its shipments to the right name.</p>}
      <section className="card">
        {clients.length === 0 ? <p className="muted">No clients yet.</p> : (
          <table>
            <thead><tr><th>Name</th><th>TIN</th><th>Contact</th><th>Email</th><th>Phone</th><th>Terms</th><th></th></tr></thead>
            <tbody>
              {clients.map((c) => (
                <tr key={c.id}>
                  <td>{c.name}</td><td>{c.tin}</td><td>{c.contact_person}</td><td>{c.email}</td><td>{c.phone}</td><td className="nowrap">{c.payment_terms_days ?? 30} days</td>
                  <td className="right">
                    {canEditClients(role) && (
                      <button className="link" onClick={() => {
                        setEditing(c.id);
                        setForm({ name: c.name, tin: c.tin ?? "", address: c.address ?? "", contact_person: c.contact_person ?? "", email: c.email ?? "", phone: c.phone ?? "", payment_terms_days: String(c.payment_terms_days ?? 30) });
                        window.scrollTo(0, 0);
                      }}>Edit</button>
                    )}
                    {role === "owner" && <button className="link" onClick={() => { setMergeFrom(c); setMergeInto(""); }}>Merge into…</button>}
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
