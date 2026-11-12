import {
  BL_RELEASE_LABEL, BL_RELEASE_TYPES, ENTRY_COLORS, ENTRY_STATUSES, pretty,
  type Client, type Job, type Profile, type ServiceType,
} from "../lib/types";

export type JobForm = {
  job_no: string; client_id: string; service_type: ServiceType; bl_awb_no: string; containers: string; vessel: string;
  voyage: string; eta: string; port_of_discharge: string; booking_no: string; carrier: string;
  entry_no: string; ticket_no: string; entry_color: string; processor_id: string; notes: string;
  client_ref_no: string; entry_status: string; final_sad_sent: boolean; ssdt_sent: boolean;
  container_at_yard_at: string; trucker_name: string; trucker_plate_no: string; delivery_address: string;
  released_at: string; port_of_destination: string; bl_release_type: string;
};
export const emptyJob: JobForm = {
  job_no: "", client_id: "", service_type: "brokerage", bl_awb_no: "", containers: "", vessel: "", voyage: "", eta: "",
  port_of_discharge: "", booking_no: "", carrier: "", entry_no: "", ticket_no: "", entry_color: "", processor_id: "", notes: "",
  client_ref_no: "", entry_status: "", final_sad_sent: false, ssdt_sent: false, container_at_yard_at: "", trucker_name: "",
  trucker_plate_no: "", delivery_address: "", released_at: "", port_of_destination: "", bl_release_type: "",
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
export const fromJob = (j: Job): JobForm => ({
  job_no: j.job_no, client_id: j.client_id, service_type: j.service_type, bl_awb_no: j.bl_awb_no ?? "",
  containers: (j.containers ?? []).join(", "), vessel: j.vessel ?? "", voyage: j.voyage ?? "", eta: j.eta ?? "",
  port_of_discharge: j.port_of_discharge ?? "", booking_no: j.booking_no ?? "", carrier: j.carrier ?? "",
  entry_no: j.entry_no ?? "", ticket_no: j.ticket_no ?? "", entry_color: j.entry_color ?? "", processor_id: j.processor_id ?? "", notes: j.notes ?? "",
  client_ref_no: j.client_ref_no ?? "", entry_status: j.entry_status ?? "", final_sad_sent: j.final_sad_sent ?? false,
  ssdt_sent: j.ssdt_sent ?? false, container_at_yard_at: toLocalInput(j.container_at_yard_at), trucker_name: j.trucker_name ?? "",
  trucker_plate_no: j.trucker_plate_no ?? "", delivery_address: j.delivery_address ?? "", released_at: toLocalInput(j.released_at),
  port_of_destination: j.port_of_destination ?? "", bl_release_type: j.bl_release_type ?? "",
});
const n = (s: string) => (s.trim() === "" ? null : s.trim());
export const toRow = (f: JobForm) => ({
  // A blank PN on a new shipment lets the database give it the next number.
  ...(f.job_no.trim() ? { job_no: f.job_no.trim().toUpperCase() } : {}),
  client_id: f.client_id, service_type: f.service_type, bl_awb_no: n(f.bl_awb_no),
  containers: f.containers.split(/[\s,;]+/).map((c) => c.trim().toUpperCase()).filter(Boolean),
  vessel: n(f.vessel), voyage: n(f.voyage), eta: n(f.eta), port_of_discharge: n(f.port_of_discharge),
  booking_no: n(f.booking_no), carrier: n(f.carrier), entry_no: n(f.entry_no),
  ticket_no: n(f.ticket_no), entry_color: n(f.entry_color),
  processor_id: n(f.processor_id), notes: n(f.notes),
  client_ref_no: n(f.client_ref_no), entry_status: n(f.entry_status), final_sad_sent: f.final_sad_sent, ssdt_sent: f.ssdt_sent,
  container_at_yard_at: fromLocalInput(f.container_at_yard_at), trucker_name: n(f.trucker_name),
  trucker_plate_no: f.trucker_plate_no.trim() ? f.trucker_plate_no.trim().toUpperCase() : null,
  delivery_address: n(f.delivery_address), released_at: fromLocalInput(f.released_at),
  port_of_destination: n(f.port_of_destination), bl_release_type: n(f.bl_release_type),
});

export default function JobFields({ form, setForm, clients, staff, lodged = false }: {
  form: JobForm; setForm: (f: JobForm) => void; clients: Client[]; staff: Profile[];
  /** The entry colour can be chosen only once the entry has been lodged. */
  lodged?: boolean;
}) {
  const set = (k: keyof JobForm) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });
  const tick = (k: "final_sad_sent" | "ssdt_sent") => (e: { target: { checked: boolean } }) => setForm({ ...form, [k]: e.target.checked });
  return (
    <div className="grid">
      <label>PN (project number)
        <input value={form.job_no} onChange={set("job_no")} maxLength={30} placeholder="Leave blank to number automatically" />
      </label>
      <label>Client
        <select value={form.client_id} onChange={set("client_id")} required>
          <option value="">Select…</option>
          {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </label>
      <label>Service
        <select value={form.service_type} onChange={set("service_type")}>
          <option value="brokerage">Brokerage</option><option value="forwarding">Forwarding</option><option value="trucking">Trucking</option>
        </select>
      </label>
      <label>Client reference no.<input value={form.client_ref_no} onChange={set("client_ref_no")} /></label>
      <label>BL / AWB no.<input value={form.bl_awb_no} onChange={set("bl_awb_no")} /></label>
      <label>BL release
        <select value={form.bl_release_type} onChange={set("bl_release_type")}>
          <option value="">Not set</option>
          {BL_RELEASE_TYPES.map((t) => <option key={t} value={t}>{BL_RELEASE_LABEL[t]}</option>)}
        </select>
      </label>
      <label>Entry no.<input value={form.entry_no} onChange={set("entry_no")} /></label>
      <label>Ticket no.<input value={form.ticket_no} onChange={set("ticket_no")} /></label>
      <label>Entry color{lodged ? "" : " (after the entry is lodged)"}
        <select value={form.entry_color} onChange={set("entry_color")} disabled={!lodged}>
          <option value="">Not set</option>
          {ENTRY_COLORS.map((c) => <option key={c} value={c}>{pretty(c)}</option>)}
        </select>
      </label>
      <label>Entry status
        <select value={form.entry_status} onChange={set("entry_status")}>
          <option value="">Not set</option>
          {ENTRY_STATUSES.map((s) => <option key={s} value={s}>{pretty(s)}</option>)}
        </select>
      </label>
      <label className="check"><input type="checkbox" checked={form.final_sad_sent} onChange={tick("final_sad_sent")} /> Final SAD sent</label>
      <label className="check"><input type="checkbox" checked={form.ssdt_sent} onChange={tick("ssdt_sent")} /> SSDT sent</label>
      <label className="wide">Containers (comma separated)<input value={form.containers} onChange={set("containers")} placeholder="MSCU1234565, …" /></label>
      <label>Vessel<input value={form.vessel} onChange={set("vessel")} /></label>
      <label>Voyage<input value={form.voyage} onChange={set("voyage")} /></label>
      <label>ETA<input type="date" value={form.eta} onChange={set("eta")} /></label>
      <label>Port of discharge<input value={form.port_of_discharge} onChange={set("port_of_discharge")} /></label>
      <label>Port of destination<input value={form.port_of_destination} onChange={set("port_of_destination")} /></label>
      <label>Container at yard<input type="datetime-local" value={form.container_at_yard_at} onChange={set("container_at_yard_at")} /></label>
      <label>Released<input type="datetime-local" value={form.released_at} onChange={set("released_at")} /></label>
      <label>Trucker<input value={form.trucker_name} onChange={set("trucker_name")} /></label>
      <label>Plate no.<input value={form.trucker_plate_no} onChange={set("trucker_plate_no")} placeholder="ABC 1234" /></label>
      <label className="wide">Delivery address<textarea rows={2} value={form.delivery_address} onChange={set("delivery_address")} /></label>
      <label>Carrier<input value={form.carrier} onChange={set("carrier")} /></label>
      <label>Booking no.<input value={form.booking_no} onChange={set("booking_no")} /></label>
      <label>Processor
        <select value={form.processor_id} onChange={set("processor_id")}>
          <option value="">Unassigned</option>
          {staff.map((p) => <option key={p.id} value={p.id}>{p.full_name || p.email}</option>)}
        </select>
      </label>
      <label className="wide">Notes<textarea rows={2} value={form.notes} onChange={set("notes")} /></label>
    </div>
  );
}
