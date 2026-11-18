import { useEffect, useState, type FormEvent } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { STATUS_LABEL, canEditClients, type Client, type JobStatus } from "../lib/types";

/** Steps a client can choose to be emailed about (Released counts as Delivered). */
const NOTIFY_STEPS: JobStatus[] = ["lodged", "assessed", "paid", "gatepass", "tabs", "delivered"];
const DEFAULT_STEPS = ["lodged", "assessed", "delivered"];
const portalLink = (token: string) => `${window.location.origin}/track/${token}`;

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
  // Status updates: where emails go, which steps send one, and the private client page.
  const [notifyEmail, setNotifyEmail] = useState("");
  const [notifySteps, setNotifySteps] = useState<string[]>(DEFAULT_STEPS);
  const [portalOn, setPortalOn] = useState(false);
  const resetUpdates = (c?: Client) => {
    setNotifyEmail(c?.notify_email ?? ""); setNotifySteps(c?.notify_steps ?? DEFAULT_STEPS); setPortalOn(c?.portal_enabled ?? false);
  };

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
    const mail = notifyEmail.trim();
    if (mail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(mail)) { setError("The email for status updates does not look right."); return; }
    row.notify_email = mail || null;
    row.notify_steps = notifySteps;
    row.portal_enabled = portalOn;
    const current = clients.find((c) => c.id === editing);
    if (portalOn && !current?.portal_token) row.portal_token = crypto.randomUUID();
    const res = editing
      ? await supabase.from("clients").update(row).eq("id", editing)
      : await supabase.from("clients").insert(row);
    if (res.error) { setError(res.error.message); return; }
    setForm(blank);
    setEditing(null);
    resetUpdates();
    load();
  }

  async function copyLink(c: Client) {
    if (!c.portal_token) return;
    try { await navigator.clipboard.writeText(portalLink(c.portal_token)); setNotice(`Link to ${c.name}'s client page copied. Send it to the client.`); }
    catch { window.prompt("Copy this link:", portalLink(c.portal_token)); }
  }
  /** A new secret link: the old one stops working at once (for a link sent to the wrong person). */
  async function newLink(c: Client) {
    if (!confirm(`Make a new link for ${c.name}? The old link stops working at once, and the client needs the new one.`)) return;
    setError(""); setNotice("");
    const { error } = await supabase.from("clients").update({ portal_token: crypto.randomUUID() }).eq("id", c.id);
    if (error) setError(error.message); else { setNotice(`New link made for ${c.name}. Use Copy link to send it.`); load(); }
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
          <fieldset className="client-updates">
            <legend>Status updates for this client</legend>
            <label>Email for updates
              <input type="email" value={notifyEmail} onChange={(e) => setNotifyEmail(e.target.value)}
                placeholder={form.email ? `e.g. ${form.email}` : "Leave blank for no emails"} />
            </label>
            {notifyEmail.trim() && <>
              <span className="field-label">Send an email when the shipment reaches:</span>
              <div className="row wrap">
                {NOTIFY_STEPS.map((st) => (
                  <label key={st} className="check">
                    <input type="checkbox" checked={notifySteps.includes(st)}
                      onChange={(e) => setNotifySteps(e.target.checked ? [...notifySteps, st] : notifySteps.filter((x) => x !== st))} />
                    {STATUS_LABEL[st]}
                  </label>
                ))}
              </div>
            </>}
            <label className="check">
              <input type="checkbox" checked={portalOn} onChange={(e) => setPortalOn(e.target.checked)} />
              Client page on: the client can see their open shipments (steps, ETA, vessel) with a private link. No amounts or documents are shown.
            </label>
          </fieldset>
          <div className="row">
            <button>{editing ? "Save" : "Add client"}</button>
            {editing && <button type="button" className="ghost" onClick={() => { setEditing(null); setForm(blank); resetUpdates(); }}>Cancel</button>}
          </div>
        </form>
      )}
      {role === "owner" && <p className="muted small">Same client saved under two spellings? Use “Merge into…” on the misspelt one to move its shipments to the right name.</p>}
      <section className="card">
        {clients.length === 0 ? <p className="muted">No clients yet.</p> : (
          <table>
            <thead><tr><th>Name</th><th>TIN</th><th>Contact</th><th>Email</th><th>Phone</th><th>Terms</th><th>Updates</th><th></th></tr></thead>
            <tbody>
              {clients.map((c) => (
                <tr key={c.id}>
                  <td>{c.name}</td><td>{c.tin}</td><td>{c.contact_person}</td><td>{c.email}</td><td>{c.phone}</td><td className="nowrap">{c.payment_terms_days ?? 30} days</td>
                  <td className="small">
                    {c.notify_email ? <div title={(c.notify_steps ?? []).map((st) => STATUS_LABEL[st as JobStatus] ?? st).join(", ")}>✉ {c.notify_email}</div> : <span className="muted">No emails</span>}
                    {c.portal_enabled && c.portal_token && (
                      <div className="nowrap">Client page: <button type="button" className="link" onClick={() => copyLink(c)}>Copy link</button>
                        {canEditClients(role) && <button type="button" className="link" onClick={() => newLink(c)}>New link</button>}</div>
                    )}
                  </td>
                  <td className="right">
                    {canEditClients(role) && (
                      <button className="link" onClick={() => {
                        setEditing(c.id);
                        resetUpdates(c);
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
