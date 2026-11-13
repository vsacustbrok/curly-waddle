import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { supabase } from "../lib/supabase";
import {
  BL_RELEASE_LABEL, BL_RELEASE_TYPES, ENTRY_COLORS, ENTRY_STATUSES, pretty,
  type Client, type Job, type Profile, type ServiceType,
} from "../lib/types";

export type JobForm = {
  job_no: string; client_id: string; client_ref_no: string; service_type: ServiceType; processor_id: string;
  carrier: string; vessel: string; voyage: string; bl_awb_no: string; booking_no: string; containers: string[];
  eta: string; port_of_discharge: string; port_of_destination: string;
  cro_no: string; cro_valid_until: string; bl_release_type: string; obl_pickup_date: string; obl_shipping_date: string; telex_release_date: string;
  entry_no: string; entry_filed_date: string; ticket_no: string; entry_status: string; entry_color: string;
  final_sad_sent: boolean; final_sad_sent_date: string; ssdt_sent: boolean; ssdt_sent_date: string;
  container_at_yard_at: string; released_at: string; trucker_name: string; trucker_plate_no: string; delivery_address: string;
  item_description: string; supplier: string; dp_contract: string; yard: string; empty_return: string; empty_return_date: string;
  lodge_remarks: string; lodge_remarks_2: string; lodge_note: string; lodge_status: string;
  gatepass_ref: string; gatepass_date: string; tabs_ref: string; tabs_at: string;
  notes: string;
};
export const emptyJob: JobForm = {
  job_no: "", client_id: "", client_ref_no: "", service_type: "brokerage", processor_id: "",
  carrier: "", vessel: "", voyage: "", bl_awb_no: "", booking_no: "", containers: [""],
  eta: "", port_of_discharge: "", port_of_destination: "",
  cro_no: "", cro_valid_until: "", bl_release_type: "", obl_pickup_date: "", obl_shipping_date: "", telex_release_date: "",
  entry_no: "", entry_filed_date: "", ticket_no: "", entry_status: "", entry_color: "",
  final_sad_sent: false, final_sad_sent_date: "", ssdt_sent: false, ssdt_sent_date: "",
  container_at_yard_at: "", released_at: "", trucker_name: "", trucker_plate_no: "", delivery_address: "",
  item_description: "", supplier: "", dp_contract: "", yard: "", empty_return: "", empty_return_date: "",
  lodge_remarks: "", lodge_remarks_2: "", lodge_note: "", lodge_status: "",
  gatepass_ref: "", gatepass_date: "", tabs_ref: "", tabs_at: "",
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
  booking_no: j.booking_no ?? "", containers: j.containers?.length ? [...j.containers] : [""],
  eta: j.eta ?? "", port_of_discharge: j.port_of_discharge ?? "", port_of_destination: j.port_of_destination ?? "",
  cro_no: j.cro_no ?? "", cro_valid_until: j.cro_valid_until ?? "", bl_release_type: j.bl_release_type ?? "", obl_pickup_date: j.obl_pickup_date ?? "",
  obl_shipping_date: j.obl_shipping_date ?? "", telex_release_date: j.telex_release_date ?? "",
  entry_no: j.entry_no ?? "", entry_filed_date: j.entry_filed_date ?? "", ticket_no: j.ticket_no ?? "", entry_status: j.entry_status ?? "", entry_color: j.entry_color ?? "",
  final_sad_sent: j.final_sad_sent ?? false, final_sad_sent_date: j.final_sad_sent_date ?? "",
  ssdt_sent: j.ssdt_sent ?? false, ssdt_sent_date: j.ssdt_sent_date ?? "",
  container_at_yard_at: toLocalInput(j.container_at_yard_at), released_at: toLocalInput(j.released_at),
  trucker_name: j.trucker_name ?? "", trucker_plate_no: j.trucker_plate_no ?? "", delivery_address: j.delivery_address ?? "",
  item_description: j.item_description ?? "", supplier: j.supplier ?? "", dp_contract: j.dp_contract ?? "", yard: j.yard ?? "",
  empty_return: j.empty_return ?? "", empty_return_date: j.empty_return_date ?? "",
  lodge_remarks: j.lodge_remarks ?? "", lodge_remarks_2: j.lodge_remarks_2 ?? "", lodge_note: j.lodge_note ?? "", lodge_status: j.lodge_status ?? "",
  gatepass_ref: j.gatepass_ref ?? "", gatepass_date: j.gatepass_date ?? "", tabs_ref: j.tabs_ref ?? "", tabs_at: toLocalInput(j.tabs_at),
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
    containers: [...new Set(f.containers.map((c) => c.replace(/\s+/g, "").toUpperCase()).filter(Boolean))],
    eta: n(f.eta), port_of_discharge: n(f.port_of_discharge), port_of_destination: n(f.port_of_destination),
    // Only the dates that belong to the chosen kind of release are kept.
    cro_no: n(f.cro_no), cro_valid_until: n(f.cro_valid_until),
    bl_release_type: n(rel),
    obl_pickup_date: rel === "original" ? n(f.obl_pickup_date) : null,
    obl_shipping_date: rel === "original" ? n(f.obl_shipping_date) : null,
    telex_release_date: rel === "telex" || rel === "seaway" ? n(f.telex_release_date) : null,
    entry_no: n(f.entry_no), entry_filed_date: n(f.entry_filed_date), ticket_no: n(f.ticket_no), entry_status: n(f.entry_status), entry_color: n(f.entry_color),
    final_sad_sent: f.final_sad_sent, final_sad_sent_date: f.final_sad_sent ? n(f.final_sad_sent_date) : null,
    ssdt_sent: f.ssdt_sent, ssdt_sent_date: f.ssdt_sent ? n(f.ssdt_sent_date) : null,
    container_at_yard_at: fromLocalInput(f.container_at_yard_at), released_at: fromLocalInput(f.released_at),
    trucker_name: n(f.trucker_name),
    trucker_plate_no: f.trucker_plate_no.trim() ? f.trucker_plate_no.trim().toUpperCase() : null,
    delivery_address: n(f.delivery_address), notes: n(f.notes),
    item_description: n(f.item_description), supplier: n(f.supplier), dp_contract: n(f.dp_contract), yard: n(f.yard),
    empty_return: n(f.empty_return), empty_return_date: n(f.empty_return_date),
    lodge_remarks: n(f.lodge_remarks), lodge_remarks_2: n(f.lodge_remarks_2), lodge_note: n(f.lodge_note), lodge_status: n(f.lodge_status),
    gatepass_ref: n(f.gatepass_ref), gatepass_date: n(f.gatepass_date), tabs_ref: n(f.tabs_ref), tabs_at: fromLocalInput(f.tabs_at),
  };
};

/** The words shown for each field, in the order of the form. */
export const FIELD_LABEL: Record<keyof JobForm, string> = {
  job_no: "PN (project number)", client_id: "Client", client_ref_no: "Client reference no.", service_type: "Service",
  processor_id: "Processor", item_description: "Item description", supplier: "Supplier", carrier: "Carrier", vessel: "Vessel", voyage: "Voyage", bl_awb_no: "BL / AWB no.",
  booking_no: "Booking no.", containers: "Containers", eta: "ETA", port_of_discharge: "Port of discharge",
  port_of_destination: "Warehouse", cro_no: "CRO no.", cro_valid_until: "CRO valid until", bl_release_type: "BL release",
  obl_pickup_date: "Original BL picked up", obl_shipping_date: "Original BL shipping date", telex_release_date: "Telex / SWB date",
  entry_no: "Entry no.", entry_filed_date: "Entry filed on", ticket_no: "Ticket no.", entry_status: "Entry status", entry_color: "Entry color", lodge_status: "Lodge status code", dp_contract: "DP / contract",
  final_sad_sent: "Final SAD sent", final_sad_sent_date: "Final SAD sent on", ssdt_sent: "SSDT sent", ssdt_sent_date: "SSDT sent on",
  gatepass_ref: "Gatepass ref. no.", gatepass_date: "Gatepass date", tabs_ref: "TABS booking ref. no.", tabs_at: "TABS date and time",
  container_at_yard_at: "Container at yard", released_at: "Released", trucker_name: "Trucker", trucker_plate_no: "Plate no.",
  delivery_address: "Delivery address", yard: "Yard",
  empty_return: "Empty return", empty_return_date: "Empty return date",
  lodge_remarks: "Remarks", lodge_remarks_2: "Remarks 2", lodge_note: "Note", notes: "General notes",
};

/** What changed between two versions of the form, as "label: before → after", for the confirmation step. */
export function describeChanges(before: JobForm, after: JobForm, names: { clients: Client[]; staff: Profile[] }): string[] {
  const shown = (k: keyof JobForm, f: JobForm): string => {
    const v = f[k];
    if (Array.isArray(v)) return v.map((c) => c.trim().toUpperCase()).filter(Boolean).join(" ") || "empty";
    if (typeof v === "boolean") return v ? "Yes" : "No";
    if (!v) return "empty";
    if (k === "client_id") return names.clients.find((c) => c.id === v)?.name ?? v;
    if (k === "processor_id") return names.staff.find((p) => p.id === v)?.full_name || names.staff.find((p) => p.id === v)?.email || v;
    if (k === "bl_release_type") return BL_RELEASE_LABEL[v as keyof typeof BL_RELEASE_LABEL] ?? v;
    if (k === "entry_status" || k === "entry_color" || k === "service_type") return pretty(v);
    if (k === "container_at_yard_at" || k === "released_at" || k === "tabs_at") return v.replace("T", " ");
    return v;
  };
  return (Object.keys(FIELD_LABEL) as (keyof JobForm)[])
    .filter((k) => shown(k, before) !== shown(k, after))
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

type Pick = { supplier: string | null; empty_return: string | null; carrier: string | null; vessel: string | null; port_of_discharge: string | null; port_of_destination: string | null;
  trucker_name: string | null; trucker_plate_no: string | null; delivery_address: string | null; client_id: string };
export type Suggestions = { lists: Record<string, string[]>; plateFor: Map<string, string>; addressesFor: Map<string, string[]> };
const SUGGESTED = ["supplier", "empty_return", "carrier", "vessel", "port_of_discharge", "port_of_destination", "trucker_name", "trucker_plate_no", "delivery_address"] as const;

/** Earlier values typed on other shipments, newest first, so they can be picked instead of typed again. */
export function useSuggestions(): Suggestions {
  const [sugg, setSugg] = useState<Suggestions>({ lists: {}, plateFor: new Map(), addressesFor: new Map() });
  useEffect(() => {
    supabase.from("jobs").select(`client_id, ${SUGGESTED.join(", ")}`).order("updated_at", { ascending: false }).limit(500)
      .then(({ data }) => {
        const rows = (data as unknown as Pick[]) ?? [];
        const lists: Record<string, string[]> = {};
        for (const k of SUGGESTED) lists[k] = [...new Set(rows.map((r) => r[k]?.trim()).filter((v): v is string => !!v))];
        const plateFor = new Map<string, string>();
        const addressesFor = new Map<string, string[]>();
        for (const r of rows) {
          if (r.trucker_name && r.trucker_plate_no && !plateFor.has(r.trucker_name.trim())) plateFor.set(r.trucker_name.trim(), r.trucker_plate_no);
          if (r.delivery_address) {
            const list = addressesFor.get(r.client_id) ?? [];
            if (!list.includes(r.delivery_address)) addressesFor.set(r.client_id, [...list, r.delivery_address]);
          }
        }
        setSugg({ lists, plateFor, addressesFor });
      });
  }, []);
  return sugg;
}

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
  const sugg = useSuggestions();
  /** A text box that also offers earlier values in a drop-down. */
  const pick = (k: typeof SUGGESTED[number], placeholder?: string) => (
    <input value={form[k]} onChange={set(k)} list={`list-${k}`} placeholder={placeholder ?? "Type or pick from earlier entries"} autoComplete="off" />
  );
  const setContainer = (i: number, v: string) => {
    const next = [...form.containers]; next[i] = v.toUpperCase();
    setForm({ ...form, containers: next }, `container-${i}`);
  };
  const chooseTrucker = (e: { target: { value: string } }) => {
    const name = e.target.value;
    const plate = sugg.plateFor.get(name.trim());
    setForm({ ...form, trucker_name: name, trucker_plate_no: plate && !form.trucker_plate_no ? plate : form.trucker_plate_no }, "trucker_name");
  };
  const clientAddresses = sugg.addressesFor.get(form.client_id) ?? [];

  return (
    <>
      {SUGGESTED.map((k) => (
        <datalist key={k} id={`list-${k}`}>
          {(k === "delivery_address" ? [...clientAddresses, ...(sugg.lists[k] ?? []).filter((a) => !clientAddresses.includes(a))] : sugg.lists[k] ?? [])
            .slice(0, 50).map((v) => <option key={v} value={v} />)}
        </datalist>
      ))}
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
        <label>Item description<input value={form.item_description} onChange={set("item_description")} placeholder="e.g. Frozen beef cuts" /></label>
        <label>Supplier{pick("supplier")}</label>
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
        <label>Carrier{pick("carrier")}</label>
        <label>Vessel{pick("vessel")}</label>
        <label>Voyage<input value={form.voyage} onChange={set("voyage")} /></label>
        <label>BL / AWB no.<input value={form.bl_awb_no} onChange={set("bl_awb_no")} /></label>
        <label>Booking no.<input value={form.booking_no} onChange={set("booking_no")} /></label>
        <label>ETA{date("eta")}</label>
        <label>Port of discharge{pick("port_of_discharge")}</label>
        <label>Warehouse{pick("port_of_destination")}</label>
        <div className="wide containers">
          <span className="field-label">Containers</span>
          {form.containers.map((c, i) => (
            <div key={i} className="row container-row">
              <input value={c} onChange={(e) => setContainer(i, e.target.value)} placeholder="e.g. MSCU1234565" aria-label={`Container ${i + 1}`} maxLength={15} />
              {form.containers.length > 1 && (
                <button type="button" className="link danger-text" aria-label={`Remove container ${i + 1}`}
                  onClick={() => setForm({ ...form, containers: form.containers.filter((_, j) => j !== i) })}>Remove</button>
              )}
            </div>
          ))}
          <button type="button" className="ghost small" onClick={() => setForm({ ...form, containers: [...form.containers, ""] })}>+ Add container</button>
        </div>
      </fieldset>

      <fieldset className="grid">
        <legend>3. CRO and BL release</legend>
        <label>CRO no.<input value={form.cro_no} onChange={set("cro_no")} /></label>
        <label>CRO valid until{date("cro_valid_until")}</label>
        <label>BL release by
          <select value={rel} onChange={set("bl_release_type")}>
            <option value="">Not set</option>
            {BL_RELEASE_TYPES.map((t) => <option key={t} value={t}>{BL_RELEASE_LABEL[t]}</option>)}
          </select>
        </label>
        {rel === "original" && <label>Original BL picked up{date("obl_pickup_date")}</label>}
        {rel === "original" && <label>Original BL shipping date{date("obl_shipping_date")}</label>}
        {(rel === "telex" || rel === "seaway") && <label>{rel === "telex" ? "Telex released on" : "SWB date"}{date("telex_release_date")}</label>}
      </fieldset>

      <fieldset className="grid">
        <legend>4. Entry filing</legend>
        <label>Entry no.<input value={form.entry_no} onChange={set("entry_no")} /></label>
        <label>Entry filed on{date("entry_filed_date")}</label>
        <label>Ticket no.<input value={form.ticket_no} onChange={set("ticket_no")} /></label>
        <label>Lodge status code<input value={form.lodge_status} onChange={set("lodge_status")} placeholder="e.g. F/S/P" /></label>
        <label>DP / contract<input value={form.dp_contract} onChange={set("dp_contract")} /></label>
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
        <legend>5. Gatepass, TABS, release and delivery</legend>
        <label className="kw-gatepass-label">Gatepass ref. no.<input value={form.gatepass_ref} onChange={set("gatepass_ref")} /></label>
        <label className="kw-gatepass-label">Gatepass date{date("gatepass_date")}</label>
        <label className="kw-tabs-label">TABS booking ref. no.<input value={form.tabs_ref} onChange={set("tabs_ref")} /></label>
        <label className="kw-tabs-label">TABS date and time<input type="datetime-local" value={form.tabs_at} onChange={set("tabs_at")} {...pickOnly} /></label>
        <label>Yard (arrival as written)<input value={form.yard} onChange={set("yard")} placeholder="e.g. YARD 01/05/26 01:22 AM" /></label>
        <label>Container at yard<input type="datetime-local" value={form.container_at_yard_at} onChange={set("container_at_yard_at")} {...pickOnly} /></label>
        <label>Released<input type="datetime-local" value={form.released_at} onChange={set("released_at")} {...pickOnly} /></label>
        <label>Trucker<input value={form.trucker_name} onChange={chooseTrucker} list="list-trucker_name" placeholder="Type or pick from earlier entries" autoComplete="off" /></label>
        <label>Plate no.{pick("trucker_plate_no", "ABC 1234")}</label>
        <label className="wide">Delivery address{pick("delivery_address", clientAddresses.length ? "Pick this client's earlier address or type a new one" : undefined)}</label>
        <label>Empty return (where){pick("empty_return")}</label>
        <label>Empty return date{date("empty_return_date")}</label>
      </fieldset>

      <fieldset className="grid">
        <legend>6. Remarks and notes</legend>
        <label>Remarks<input value={form.lodge_remarks} onChange={set("lodge_remarks")} /></label>
        <label>Remarks 2<input value={form.lodge_remarks_2} onChange={set("lodge_remarks_2")} /></label>
        <label className="wide">Note<input value={form.lodge_note} onChange={set("lodge_note")} /></label>
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
