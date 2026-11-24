// Permits and accreditations: each client's and the office's own, with expiry warnings.
// Owner and processors add and update them; the owner deletes; all office staff see them.
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { dayLabel, today } from "../lib/types";
import { PERMIT_KINDS, PERMIT_LABEL, WARN_DAYS, daysLeft, permitName, stateOf, type Permit, type PermitKind, type PermitState } from "../lib/permits";
import { loadPermits } from "./PermitBanner";

const STATE_LABEL: Record<PermitState, string> = { expired: "Expired", soon: `Expires within ${WARN_DAYS} days`, ok: "Valid", renewed: "Renewed (old)" };
const OFFICE = "__office__";

export default function Permits() {
  const { profile } = useAuth();
  const canEdit = profile?.role === "owner" || profile?.role === "processor";
  const isOwner = profile?.role === "owner";
  const [rows, setRows] = useState<Permit[] | null>(null);
  const [clients, setClients] = useState<{ id: string; name: string }[]>([]);
  const [filter, setFilter] = useState(() => new URLSearchParams(location.search).get("client") ?? "");
  const [showAll, setShowAll] = useState(false);
  const [error, setError] = useState("");
  const blank = { owner: "", kind: "boc_accreditation" as PermitKind, title: "", reference_no: "", issued_on: "", expires_on: "", note: "" };
  const [f, setF] = useState(blank);
  const [busy, setBusy] = useState(false);
  const now = today();

  const load = useCallback(() => loadPermits(true).then(setRows, (e: Error) => { setError(e.message); setRows([]); }), []);
  useEffect(() => {
    load();
    supabase.from("clients").select("id, name").order("name").then(({ data }) => setClients((data as { id: string; name: string }[]) ?? []));
  }, [load]);

  const shown = useMemo(() => (rows ?? [])
    .filter((p) => !filter || (filter === OFFICE ? !p.client_id : p.client_id === filter))
    .filter((p) => showAll || stateOf(p, now) !== "renewed")
    .sort((a, b) => a.expires_on.localeCompare(b.expires_on)), [rows, filter, showAll, now]);
  const count = (s: PermitState) => (rows ?? []).filter((p) => stateOf(p, now) === s).length;

  async function add(e: FormEvent) {
    e.preventDefault(); setError("");
    if (!f.expires_on) { setError("Enter the expiry date."); return; }
    if (f.issued_on && f.issued_on > f.expires_on) { setError("The issue date is after the expiry date."); return; }
    setBusy(true);
    const { error } = await supabase.from("permits").insert({
      client_id: f.owner && f.owner !== OFFICE ? f.owner : null, kind: f.kind, title: f.title.trim() || null, reference_no: f.reference_no.trim() || null,
      issued_on: f.issued_on || null, expires_on: f.expires_on, note: f.note.trim() || null,
    });
    setBusy(false);
    if (error) { setError(error.message); return; }
    setF({ ...blank, owner: f.owner }); load();
  }
  async function change(p: Permit, patch: Partial<Permit>) {
    const { error } = await supabase.from("permits").update(patch).eq("id", p.id);
    if (error) setError(error.message); else load();
  }
  async function remove(p: Permit) {
    if (!confirm(`Delete ${permitName(p)}${p.reference_no ? ` no. ${p.reference_no}` : ""}?`)) return;
    const { error } = await supabase.from("permits").delete().eq("id", p.id);
    if (error) setError(error.message); else load();
  }

  return (
    <>
      <h1>Permits and accreditations</h1>
      <div className="row stat-row">
        <span className="alert-chip big overdue"><strong>{rows ? count("expired") : "…"}</strong> expired</span>
        <span className="alert-chip big soon"><strong>{rows ? count("soon") : "…"}</strong> within {WARN_DAYS} days</span>
        <span className="stat">Valid <strong>{rows ? count("ok") : "…"}</strong></span>
      </div>
      <p className="muted small">Shipments of a client with a lapsed or lapsing permit show a warning on the shipment and in the Pre-Lodgment Audit. When a permit is renewed, add the new one and tick Renewed on the old one.</p>
      {error && <p className="error" role="alert">{error}</p>}

      {canEdit && (
        <details className="card" open={rows !== null && rows.length === 0}>
          <summary><strong>Add a permit</strong></summary>
          <form onSubmit={add}>
            <div className="grid">
              <label>Whose
                <select value={f.owner} onChange={(e) => setF({ ...f, owner: e.target.value })} required>
                  <option value="">Choose…</option>
                  <option value={OFFICE}>The office (VSA)</option>
                  {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </label>
              <label>Type<select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as PermitKind })}>{PERMIT_KINDS.map((k) => <option key={k} value={k}>{PERMIT_LABEL[k]}</option>)}</select></label>
              <label>Product / details (optional)<input value={f.title} maxLength={120} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="e.g. frozen chicken MDM" /></label>
              <label>Reference no.<input value={f.reference_no} maxLength={80} onChange={(e) => setF({ ...f, reference_no: e.target.value })} /></label>
              <label>Issued<input type="date" value={f.issued_on} onChange={(e) => setF({ ...f, issued_on: e.target.value })} /></label>
              <label>Expires<input type="date" value={f.expires_on} onChange={(e) => setF({ ...f, expires_on: e.target.value })} required /></label>
              <label className="wide">Note<input value={f.note} maxLength={300} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="e.g. renewal filed, waiting for release" /></label>
            </div>
            <button disabled={busy}>{busy ? "Saving…" : "Add permit"}</button>
          </form>
        </details>
      )}

      <section className="card">
        <div className="row spread wrap">
          <label className="row">Show
            <select value={filter} onChange={(e) => setFilter(e.target.value)}>
              <option value="">Everyone</option><option value={OFFICE}>The office (VSA)</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label className="check"><input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> Include renewed (old) ones</label>
        </div>
        {rows === null ? <p className="muted">Loading…</p> : shown.length === 0 ? <p className="muted">No permits recorded{filter ? " for this choice" : ""} yet.</p> : (
          <div className="table-scroll">
            <table className="small">
              <thead><tr><th>Whose</th><th>Permit</th><th>Reference no.</th><th>Issued</th><th>Expires</th><th>Status</th><th>Note</th>{canEdit && <th></th>}</tr></thead>
              <tbody>
                {shown.map((p) => {
                  const st = stateOf(p, now);
                  const d = daysLeft(p.expires_on, now);
                  return (
                    <tr key={p.id} className={st === "renewed" ? "muted-row" : ""}>
                      <td>{p.clients?.name ?? <strong>VSA (office)</strong>}</td>
                      <td>{permitName(p)}</td><td>{p.reference_no}</td>
                      <td className="nowrap">{dayLabel(p.issued_on)}</td><td className="nowrap">{dayLabel(p.expires_on)}</td>
                      <td className="nowrap">{st === "expired" ? <span className="alert-chip overdue">Expired {-d} day{d === -1 ? "" : "s"} ago</span>
                        : st === "soon" ? <span className="alert-chip soon">{d === 0 ? "Expires today" : `${d} day${d === 1 ? "" : "s"} left`}</span>
                        : <span className="badge">{STATE_LABEL[st]}</span>}</td>
                      <td>{p.note}</td>
                      {canEdit && <td className="nowrap">
                        <label className="check small"><input type="checkbox" checked={p.renewed} onChange={(e) => change(p, { renewed: e.target.checked })} /> Renewed</label>
                        {isOwner && <button type="button" className="link danger-text small" onClick={() => remove(p)}>Delete</button>}
                      </td>}
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
