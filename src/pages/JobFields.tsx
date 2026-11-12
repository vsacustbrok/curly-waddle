import type { Client, Job, Profile, ServiceType } from "../lib/types";

export type JobForm = {
  job_no: string; client_id: string; service_type: ServiceType; bl_awb_no: string; containers: string; vessel: string;
  voyage: string; eta: string; port_of_discharge: string; booking_no: string; carrier: string;
  entry_no: string; processor_id: string; notes: string;
};
export const emptyJob: JobForm = {
  job_no: "", client_id: "", service_type: "brokerage", bl_awb_no: "", containers: "", vessel: "", voyage: "", eta: "",
  port_of_discharge: "", booking_no: "", carrier: "", entry_no: "", processor_id: "", notes: "",
};
export const fromJob = (j: Job): JobForm => ({
  job_no: j.job_no, client_id: j.client_id, service_type: j.service_type, bl_awb_no: j.bl_awb_no ?? "",
  containers: (j.containers ?? []).join(", "), vessel: j.vessel ?? "", voyage: j.voyage ?? "", eta: j.eta ?? "",
  port_of_discharge: j.port_of_discharge ?? "", booking_no: j.booking_no ?? "", carrier: j.carrier ?? "",
  entry_no: j.entry_no ?? "", processor_id: j.processor_id ?? "", notes: j.notes ?? "",
});
const n = (s: string) => (s.trim() === "" ? null : s.trim());
export const toRow = (f: JobForm) => ({
  // A blank PN on a new shipment lets the database give it the next number.
  ...(f.job_no.trim() ? { job_no: f.job_no.trim().toUpperCase() } : {}),
  client_id: f.client_id, service_type: f.service_type, bl_awb_no: n(f.bl_awb_no),
  containers: f.containers.split(/[\s,;]+/).map((c) => c.trim().toUpperCase()).filter(Boolean),
  vessel: n(f.vessel), voyage: n(f.voyage), eta: n(f.eta), port_of_discharge: n(f.port_of_discharge),
  booking_no: n(f.booking_no), carrier: n(f.carrier), entry_no: n(f.entry_no),
  processor_id: n(f.processor_id), notes: n(f.notes),
});

export default function JobFields({ form, setForm, clients, staff }: {
  form: JobForm; setForm: (f: JobForm) => void; clients: Client[]; staff: Profile[];
}) {
  const set = (k: keyof JobForm) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });
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
      <label>BL / AWB no.<input value={form.bl_awb_no} onChange={set("bl_awb_no")} /></label>
      <label>Entry no.<input value={form.entry_no} onChange={set("entry_no")} /></label>
      <label className="wide">Containers (comma separated)<input value={form.containers} onChange={set("containers")} placeholder="MSCU1234565, …" /></label>
      <label>Vessel<input value={form.vessel} onChange={set("vessel")} /></label>
      <label>Voyage<input value={form.voyage} onChange={set("voyage")} /></label>
      <label>ETA<input type="date" value={form.eta} onChange={set("eta")} /></label>
      <label>Port of discharge<input value={form.port_of_discharge} onChange={set("port_of_discharge")} /></label>
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
