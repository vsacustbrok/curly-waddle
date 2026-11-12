import { useCallback, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import {
  BL_RELEASE_LABEL, BL_RELEASE_TYPES, ENTRY_COLORS, ENTRY_STATUSES, pretty,
  type Client, type Job, type Profile, type ServiceType,
} from "../lib/types";

export type JobForm = {
  job_no: string; client_id: string; client_ref_no: string; service_type: ServiceType; processor_id: string;
  carrier: string; vessel: string; voyage: string; bl_awb_no: string; booking_no: string; containers: string;
  eta: string; port_of_discharge: string; port_of_destination: string;
  bl_release_type: string; cro_valid_until: string; obl_pickup_date: string; obl_shipping_date: string; telex_release_date: string;
  entry_no: string; ticket_no: string; entry_status: string; entry_color: string;
  final_sad_sent: boolean; final_sad_sent_date: string; ssdt_sent: boolean; ssdt_sent_date: string;
  container_at_yard_at: string; released_at: string; trucker_name: string; trucker_plate_no: string; delivery_address: string;
  notes: string;
};
export const emptyJob: JobForm = {
  job_no: "", client_id: "", client_ref_no: "", service_type: "brokerage", processor_id: "",
  carrier: "", vessel: "", voyage: "", bl_awb_no: "", booking_no: "", containers: "",
  eta: "", port_of_discharge: "", port_of_destination: "",
  bl_release_type: "", cro_valid_until: "", obl_pickup_date: "", obl_shipping_date: "", telex_release_date: "",
  entry_no: "", ticket_no: "", entry_status: "", entry_color: "",
  final_sad_sent: false, final_sad_sent_date: "", ssdt_sent: false, ssdt_sent_date: "",
  container_at_yard_at: "", released_at: "", trucker_name: "", trucker_plate_no: "", delivery_address: "",
  notes: "",
};

/** A stored timestamp as the value a date-and-time box expects (local time, "YYYY-MM-DDTHH:mm"). */
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const p = (x: number) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
/** A date-and-time box value (local time) as a full timestamp, so it shows the same for everyone. */
const fromLocalInput = (v: string) => (v ? new Date(v).toISOString() : null);
/** Today in the viewer's own time zone, as YYYY-MM-DD. */
export function today(): string {
  const d = new Date();
  const p = (x: number) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export const fromJob = (j: Job): JobForm => ({
  job_no: j.job_no, client_id: j.client_id, client_ref_no: j.client_ref_no ?? "", service_type: j.service_type,
  processor_id: j.processor_id ?? "",
  carrier: j.carrier ?? "", vessel: j.vessel ?? "", voyage: j.voyage ?? "", bl_awb_no: j.bl_awb_no ?? "",
  booking_no: j.booking_no ?? "", containers: (j.containers ?? []).join(", "),
  eta: j.eta ?? "", port_of_discharge: j.port_of_discharge ?? "", port_of_destination: j.port_of_destination ?? "",
  bl_release_type: j.bl_release_type ?? "", cro_valid_until: j.cro_valid_until ?? "", obl_pickup_date: j.obl_pickup_date ?? "",
  obl_shipping_date: j.obl_shipping_date ?? "", telex_release_date: j.telex_release_date ?? "",
  entry_no: j.entry_no ?? "", ticket_no: j.ticket_no ?? "", entry_status: j.entry_status ?? "", entry_color: j.entry_color ?? "",
  final_sad_sent: j.final_sad_sent ?? false, final_sad_sent_date: j.final_sad_sent_date ?? "",
  ssdt_sent: j.ssdt_sent ?? false, ssdt_sent_date: j.ssdt_sent_date ?? "",
  container_at_yard_at: toLocalInput(j.container_at_yard_at), released_at: toLocalInput(j.released_at),
  trucker_name: j.trucker_name ?? "", trucker_plate_no: j.trucker_plate_no ?? "", delivery_address: j.delivery_address ?? "",
  notes: j.notes ?? "",
});

const n = (s: string) => (s.trim() === "" ? null : s.trim());
export const toRow = (f: JobForm) => {
  const rel = f.bl_release_type;
  return {
    // A blank PN on a new shipment lets the database give it the next number.
    ...(f.job_no.trim() ? { job_no: f.job_no.trim().toUpperCase() } : {}),
    client_id: f.client_id, client_ref_no: n(f.client_ref_no), service_type: f.service_type, processor_id: n(f.processor_id),
    carrier: n(f.carrier), vessel: n(f.vessel), voyage: n(f.voyage), bl_awb_no: n(f.bl_awb_no), booking_no: n(f.booking_no),
    containers: f.containers.split(/[\s,;]+/).map((c) => c.trim().toUpperCase()).filter(Boolean),
    eta: n(f.eta), port_of_discharge: n(f.port_of_discharge), port_of_destination: n(f.port_of_destination),
    // Only the dates that belong to the chosen kind of release are kept.
    bl_release_type: n(rel),
    cro_valid_until: rel === "cro" ? n(f.cro_valid_until) : null,
    obl_pickup_date: rel === "original" ? n(f.obl_pickup_date) : null,
    obl_shipping_date: rel === "original" ? n(f.obl_shipping_date) : null,
    telex_release_date: rel === "telex" || rel === "seaway" ? n(f.telex_release_date) : null,
    entry_no: n(f.entry_no), ticket_no: n(f.ticket_no), entry_status: n(f.entry_status), entry_color: n(f.entry_color),
    final_sad_sent: f.final_sad_sent, final_sad_sent_date: f.final_sad_sent ? n(f.final_sad_sent_date) : null,
    ssdt_sent: f.ssdt_sent, ssdt_sent_date: f.ssdt_sent ? n(f.ssdt_sent_date) : null,
    container_at_yard_at: fromLocalInput(f.container_at_yard_at), released_at: fromLocalInput(f.released_at),
    trucker_name: n(f.trucker_name),
    trucker_plate_no: f.trucker_plate_no.trim() ? f.trucker_plate_no.trim().toUpperCase() : null,
    delivery_address: n(f.delivery_address), notes: n(f.notes),
  };
};

/** The words shown for each field, in the order of the form. */
export const FIELD_LABEL: Record<keyof JobForm, string> = {
  job_no: "PN (project number)", client_id: "Client", client_ref_no: "Client reference no.", service_type: "Service",
  processor_id: "Processor", carrier: "Carrier", vessel: "Vessel", voyage: "Voyage", bl_awb_no: "BL / AWB no.",
  booking_no: "Booking no.", containers: "Containers", eta: "ETA", port_of_discharge: "Port of discharge",
  port_of_destination: "Port of destination", bl_release_type: "BL release", cro_valid_until: "CRO valid until",
  obl_pickup_date: "Original BL picked up", obl_shipping_date: "Original BL shipping date", telex_release_date: "Telex / seaway bill date",
  entry_no: "Entry no.", ticket_no: "Ticket no.", entry_status: "Entry status", entry_color: "Entry color",
  final_sad_sent: "Final SAD sent", final_sad_sent_date: "Final SAD sent on", ssdt_sent: "SSDT sent", ssdt_sent_date: "SSDT sent on",
  container_at_yard_at: "Container at yard", released_at: "Released", trucker_name: "Trucker", trucker_plate_no: "Plate no.",
  delivery_address: "Delivery address", notes: "General notes",
};

/** What changed between two versions of the form, as "label: before → after", for the confirmation step. */
export function describeChanges(before: JobForm, after: JobForm, names: { clients: Client[]; staff: Profile[] }): string[] {
  const shown = (k: keyof JobForm, f: JobForm): string => {
    const v = f[k];
    if (typeof v === "boolean") return v ? "Yes" : "No";
    if (!v) return "empty";
    if (k === "client_id") return names.clients.find((c) => c.id === v)?.name ?? v;
    if (k === "processor_id") return names.staff.find((p) => p.id === v)?.full_name || names.staff.find((p) => p.id === v)?.email || v;
    if (k === "bl_release_type") return BL_RELEASE_LABEL[v as keyof typeof BL_RELEASE_LABEL] ?? v;
    if (k === "entry_status" || k === "entry_color" || k === "service_type") return pretty(v);
    if (k === "container_at_yard_at" || k === "released_at") return v.replace("T", " ");
    return v;
  };
  return (Object.keys(FIELD_LABEL) as (keyof JobForm)[])
    .filter((k) => before[k] !== after[k])
    .map((k) => `${FIELD_LABEL[k]}: ${shown(k, before)} → ${shown(k, after)}`);
}

/**
 * The form with an undo and redo history. Typing in one box counts as one step until another
 * box is changed or a second passes, so Undo goes back a word or a field, not a letter.
 */
export function useFormHistory(initial: JobForm) {
  const [state, setState] = useState({ past: [] as JobForm[], present: initial, future: [] as JobForm[] });
  const last = useRef({ key: "", at: 0 });
  const set = useCallback((next: JobForm, key = "") => {
    setState((s) => {
      const now = Date.now();
      const merge = key !== "" && key === last.current.key && now - last.current.at < 1000;
      last.current = { key, at: now };
      return { past: merge ? s.past : [...s.past, s.present].slice(-100), present: next, future: [] };
    });
  }, []);
  const undo = useCallback(() => setState((s) => (s.past.length
    ? { past: s.past.slice(0, -1), present: s.past[s.past.length - 1], future: [s.present, ...s.future] } : s)), []);
  const redo = useCallback(() => setState((s) => (s.future.length
    ? { past: [...s.past, s.present], present: s.future[0], future: s.future.slice(1) } : s)), []);
  const reset = useCallback((f: JobForm) => setState({ past: [], present: f, future: [] }), []);
  return { form: state.present, set, undo, redo, reset, canUndo: state.past.length > 0, canRedo: state.future.length > 0 };
}
export type FormHistory = ReturnType<typeof useFormHistory>;

/** Typing is turned off in date boxes: a click opens the calendar, and Delete or Backspace clears the box. */
const pickOnly = {
  onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Tab") return;
    e.preventDefault();
    if (e.key === "Backspace" || e.key === "Delete") {
      const input = e.currentTarget;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(input, "");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    } else if (e.key === "Enter" || e.key === " ") {
      e.currentTarget.showPicker?.();
    }
  },
  onClick: (e: MouseEvent<HTMLInputElement>) => { e.currentTarget.showPicker?.(); },
};

export default function JobFields({ history, clients, staff, lodged = false }: {
  history: FormHistory; clients: Client[]; staff: Profile[];
  /** The entry colour can be chosen only once the entry has been lodged. */
  lodged?: boolean;
}) {
  const { form, set: setForm } = history;
  const set = (k: keyof JobForm) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value }, k);
  const tick = (k: "final_sad_sent" | "ssdt_sent", dateKey: "final_sad_sent_date" | "ssdt_sent_date") =>
    (e: { target: { checked: boolean } }) =>
      setForm({ ...form, [k]: e.target.checked, [dateKey]: e.target.checked ? form[dateKey] || today() : "" });
  const sentDate = (k: "final_sad_sent" | "ssdt_sent", dateKey: "final_sad_sent_date" | "ssdt_sent_date") =>
    (e: { target: { value: string } }) => setForm({ ...form, [dateKey]: e.target.value, [k]: e.target.value !== "" || form[k] });
  const date = (k: keyof JobForm) => (
    <input type="date" value={form[k] as string} onChange={set(k)} {...pickOnly} />
  );
  const rel = form.bl_release_type;

  return (
    <>
      <div className="row undo-bar">
        <button type="button" className="ghost small" onClick={history.undo} disabled={!history.canUndo}>↶ Undo</button>
        <button type="button" className="ghost small" onClick={history.redo} disabled={!history.canRedo}>↷ Redo</button>
        <span className="muted small">Dates are chosen from the calendar. Press Delete to clear one.</span>
      </div>

      <fieldset className="grid">
        <legend>1. Shipment and client</legend>
        <label>PN (project number)
          <input value={form.job_no} onChange={set("job_no")} maxLength={30} placeholder="Leave blank to number automatically" />
        </label>
        <label>Client
          <select value={form.client_id} onChange={set("client_id")} required>
            <option value="">Select…</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <label>Client reference no.<input value={form.client_ref_no} onChange={set("client_ref_no")} /></label>
        <label>Service
          <select value={form.service_type} onChange={set("service_type")}>
            <option value="brokerage">Brokerage</option><option value="forwarding">Forwarding</option><option value="trucking">Trucking</option>
          </select>
        </label>
        <label>Processor
          <select value={form.processor_id} onChange={set("processor_id")}>
            <option value="">Unassigned</option>
            {staff.map((p) => <option key={p.id} value={p.id}>{p.full_name || p.email}</option>)}
          </select>
        </label>
      </fieldset>

      <fieldset className="grid">
        <legend>2. Arrival</legend>
        <label>Carrier<input value={form.carrier} onChange={set("carrier")} /></label>
        <label>Vessel<input value={form.vessel} onChange={set("vessel")} /></label>
        <label>Voyage<input value={form.voyage} onChange={set("voyage")} /></label>
        <label>BL / AWB no.<input value={form.bl_awb_no} onChange={set("bl_awb_no")} /></label>
        <label>Booking no.<input value={form.booking_no} onChange={set("booking_no")} /></label>
        <label>ETA{date("eta")}</label>
        <label>Port of discharge<input value={form.port_of_discharge} onChange={set("port_of_discharge")} /></label>
        <label>Port of destination<input value={form.port_of_destination} onChange={set("port_of_destination")} /></label>
        <label className="wide">Containers (comma separated)<input value={form.containers} onChange={set("containers")} placeholder="MSCU1234565, …" /></label>
      </fieldset>

      <fieldset className="grid">
        <legend>3. BL release</legend>
        <label>Release by
          <select value={rel} onChange={set("bl_release_type")}>
            <option value="">Not set</option>
            {BL_RELEASE_TYPES.map((t) => <option key={t} value={t}>{BL_RELEASE_LABEL[t]}</option>)}
          </select>
        </label>
        {rel === "cro" && <label>CRO valid until{date("cro_valid_until")}</label>}
        {rel === "original" && <label>Original BL picked up{date("obl_pickup_date")}</label>}
        {rel === "original" && <label>Original BL shipping date{date("obl_shipping_date")}</label>}
        {(rel === "telex" || rel === "seaway") && <label>{rel === "telex" ? "Telex released on" : "Seaway bill date"}{date("telex_release_date")}</label>}
      </fieldset>

      <fieldset className="grid">
        <legend>4. Entry filing</legend>
        <label>Entry no.<input value={form.entry_no} onChange={set("entry_no")} /></label>
        <label>Ticket no.<input value={form.ticket_no} onChange={set("ticket_no")} /></label>
        <label>Entry status
          <select value={form.entry_status} onChange={set("entry_status")}>
            <option value="">Not set</option>
            {ENTRY_STATUSES.map((s) => <option key={s} value={s}>{pretty(s)}</option>)}
          </select>
        </label>
        <label>Entry color{lodged ? "" : " (after the entry is lodged)"}
          <select value={form.entry_color} onChange={set("entry_color")} disabled={!lodged}>
            <option value="">Not set</option>
            {ENTRY_COLORS.map((c) => <option key={c} value={c}>{pretty(c)}</option>)}
          </select>
        </label>
        <div className="sent">
          <label className="check"><input type="checkbox" checked={form.final_sad_sent} onChange={tick("final_sad_sent", "final_sad_sent_date")} /> Final SAD sent</label>
          <input type="date" aria-label="Final SAD sent on" value={form.final_sad_sent_date} onChange={sentDate("final_sad_sent", "final_sad_sent_date")} {...pickOnly} />
        </div>
        <div className="sent">
          <label className="check"><input type="checkbox" checked={form.ssdt_sent} onChange={tick("ssdt_sent", "ssdt_sent_date")} /> SSDT sent</label>
          <input type="date" aria-label="SSDT sent on" value={form.ssdt_sent_date} onChange={sentDate("ssdt_sent", "ssdt_sent_date")} {...pickOnly} />
        </div>
      </fieldset>

      <fieldset className="grid">
        <legend>5. Release and delivery</legend>
        <label>Container at yard<input type="datetime-local" value={form.container_at_yard_at} onChange={set("container_at_yard_at")} {...pickOnly} /></label>
        <label>Released<input type="datetime-local" value={form.released_at} onChange={set("released_at")} {...pickOnly} /></label>
        <label>Trucker<input value={form.trucker_name} onChange={set("trucker_name")} /></label>
        <label>Plate no.<input value={form.trucker_plate_no} onChange={set("trucker_plate_no")} placeholder="ABC 1234" /></label>
        <label className="wide">Delivery address<textarea rows={2} value={form.delivery_address} onChange={set("delivery_address")} /></label>
      </fieldset>

      <fieldset className="grid">
        <legend>6. General notes</legend>
        <label className="wide">Notes that stay the same for the whole shipment (use the daily status log below for day-to-day updates)
          <textarea rows={2} value={form.notes} onChange={set("notes")} />
        </label>
      </fieldset>
    </>
  );
}

/** A confirmation box listing what is about to be saved. */
export function ConfirmChanges({ title, lines, busy, onConfirm, onCancel }: {
  title: string; lines: string[]; busy: boolean; onConfirm: () => void; onCancel: () => void;
}) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={title}>
      <div className="card modal">
        <h2>{title}</h2>
        {lines.length === 0 ? <p className="muted">Nothing has changed.</p> : (
          <ul className="changes">{lines.map((l) => <li key={l}>{l}</li>)}</ul>
        )}
        <div className="row">
          <button type="button" disabled={busy || lines.length === 0} onClick={onConfirm}>{busy ? "Saving…" : "Confirm and save"}</button>
          <button type="button" className="ghost" onClick={onCancel}>Go back</button>
        </div>
      </div>
    </div>
  );
}
