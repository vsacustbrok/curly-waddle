export type Role = "owner" | "processor" | "dispatcher" | "billing" | "pending";
export type JobStatus = "pre_arrival" | "lodged" | "assessed" | "paid" | "released" | "delivered" | "billed";
export type ServiceType = "brokerage" | "forwarding" | "trucking";

export const STATUSES: JobStatus[] = ["pre_arrival", "lodged", "assessed", "paid", "released", "delivered", "billed"];
export const STATUS_LABEL: Record<JobStatus, string> = {
  pre_arrival: "Pre-arrival", lodged: "Lodged", assessed: "Assessed", paid: "Paid",
  released: "Released", delivered: "Delivered", billed: "Billed",
};
export const ROLES: Role[] = ["owner", "processor", "dispatcher", "billing", "pending"];

export const DOC_TYPES = [
  "bill_of_lading", "airway_bill", "commercial_invoice", "packing_list", "sps_import_clearance", "arrival_notice", "permit", "entry",
  "assessment", "payment_proof", "release", "delivery_receipt", "billing_statement", "other",
] as const;
/** Client that new shipments sit under until a consignee has been read. Keep in sync with scan-job/assemble.ts. */
export const PLACEHOLDER_CLIENT = "Unassigned (to be confirmed)";
export const pretty = (s: string) =>
  s === "sps_import_clearance" ? "SPS import clearance" : s.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

/** Plain names for the checks, shown instead of their internal codes. */
const CHECK_LABEL: Record<string, string> = {
  shipper_match: "Shipper name", consignee_match: "Consignee name", consignee_vs_client: "Consignee and client",
  bl_number_match: "BL / AWB number", containers_match: "Container numbers", container_check_digit: "Container number looks mistyped",
  gross_weight_match: "Gross weight", net_weight_match: "Net weight", net_vs_gross: "Net weight above gross weight",
  package_count_match: "Number of packages", invoice_total: "Invoice total", invoice_line_math: "Invoice line arithmetic",
  invoice_currency: "Invoice currency", goods_description_match: "Goods description", vessel_match: "Vessel", voyage_match: "Voyage",
  documents_present: "Missing document", extraction: "File could not be read", eta: "Arrival date (ETA)", client: "Client",
  job_details: "Project details", sps_vs_bl: "SPS and bill of lading", sps_consignee_match: "SPS importer", sps_shipper_match: "SPS exporter",
  sps_goods_match: "SPS commodity", sps_must_ship_out: "SPS must-ship-out date", sps_weight: "SPS weight (3% tolerance)",
  sps_validity: "SPS validity", notify_party_match: "Notify party", shipper_address: "Shipper address", consignee_address: "Consignee address",
  notify_party_address: "Notify party address", shipper_contact: "Shipper contact number", consignee_contact: "Consignee contact number",
  notify_party_contact: "Notify party contact number", invoice_vs_packing_items: "Invoice and packing list items",
  hs_code_present: "HS code missing", hs_code_match: "HS codes", dangerous_goods_details: "Dangerous goods details",
  dangerous_goods_un_match: "Dangerous goods UN number", volume_match: "Volume (CBM)", incoterm_present: "Incoterm missing",
  incoterm_match: "Incoterms", country_of_origin_match: "Country of origin", signature: "Signature", stamp: "Stamp or seal",
};
export const checkLabel = (check: string) => CHECK_LABEL[check] ?? pretty(check);
/** "bill_of_lading: file.pdf" -> "Bill of lading: file.pdf" */
export const prettySource = (source: string) => source.replace(/^[a-z_]+(?=:)/, (t) => (t === "job" ? "Project record" : pretty(t)));

/** The selectivity colour customs gives an entry once it is lodged. */
export const ENTRY_COLORS = ["red", "orange", "yellow"] as const;
export type EntryColor = (typeof ENTRY_COLORS)[number];
export const ENTRY_STATUSES = ["filed", "assessed", "paid"] as const;
export type EntryStatus = (typeof ENTRY_STATUSES)[number];
/** How the cargo is released by the shipping line. */
export const BL_RELEASE_TYPES = ["original", "telex", "seaway"] as const;
export type BlReleaseType = (typeof BL_RELEASE_TYPES)[number];
export const BL_RELEASE_LABEL: Record<BlReleaseType, string> = {
  original: "Original BL", telex: "Telex released", seaway: "Seaway bill (SWB)",
};
/** A stored timestamp in the viewer's local time, e.g. "Nov 12, 2026, 3:05 PM". */
export const dateTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : null;

export type Profile = { id: string; email: string | null; full_name: string; role: Role; created_at: string };
export type Client = {
  id: string; name: string; tin: string | null; address: string | null;
  contact_person: string | null; email: string | null; phone: string | null;
};
export type Job = {
  id: string; job_no: string; client_id: string; service_type: ServiceType; status: JobStatus;
  bl_awb_no: string | null; containers: string[]; vessel: string | null; voyage: string | null;
  eta: string | null; port_of_discharge: string | null; booking_no: string | null; carrier: string | null;
  entry_no: string | null; ticket_no: string | null; entry_color: EntryColor | null;
  client_ref_no: string | null; entry_status: EntryStatus | null; final_sad_sent: boolean; ssdt_sent: boolean;
  container_at_yard_at: string | null; trucker_name: string | null; trucker_plate_no: string | null;
  delivery_address: string | null; released_at: string | null; port_of_destination: string | null;
  bl_release_type: BlReleaseType | null; cro_no: string | null; entry_filed_date: string | null;
  item_description: string | null; supplier: string | null; dp_contract: string | null; yard: string | null;
  empty_return: string | null; empty_return_date: string | null;
  lodge_remarks: string | null; lodge_remarks_2: string | null; lodge_note: string | null; lodge_status: string | null; cro_valid_until: string | null; obl_pickup_date: string | null;
  obl_shipping_date: string | null; telex_release_date: string | null;
  final_sad_sent_date: string | null; ssdt_sent_date: string | null;
  processor_id: string | null; notes: string | null;
  created_at: string; updated_at: string;
  clients?: { name: string } | null;
  processor?: { full_name: string; email: string | null } | null;
};
/** One entry in a shipment's day-to-day status log. */
export type JobNote = { id: number; job_id: string; note_date: string; body: string; author_id: string | null; author_name: string | null; created_at: string };
/** A YYYY-MM-DD date as "Nov 13, 2026". */
export const dayLabel = (d: string | null) =>
  d ? new Date(d + "T00:00:00").toLocaleDateString(undefined, { dateStyle: "medium" }) : null;
export type JobDocument = {
  id: string; job_id: string; doc_type: string; file_path: string; file_name: string;
  mime_type: string | null; size_bytes: number | null; uploaded_at: string;
  extracted: Record<string, unknown> | null; extracted_at: string | null; extract_error: string | null;
};
export type Issue = { severity: "error" | "warning"; check: string; message: string; values: { source: string; value: unknown }[] };
export type Match = { check: string; value: unknown; sources: string[] };
export type ScanResult = {
  id: string; job_id: string; run_at: string; docs_scanned: number;
  error_count: number; warning_count: number; issues: Issue[]; matches: Match[];
  duration_ms: number | null;
};
export type StatusHistory = {
  id: number; from_status: JobStatus | null; to_status: JobStatus; changed_by_name: string | null; changed_at: string;
};

/** Statuses this role may move a job to from `current`. Mirrors the database trigger, which is the real gate. */
export function allowedNextStatuses(role: Role, current: JobStatus): JobStatus[] {
  const i = STATUSES.indexOf(current);
  return STATUSES.filter((s, j) => {
    if (s === current) return false;
    if (j < i && role !== "owner") return false;
    if (s === "billed" && current !== "delivered") return false;
    if (role === "dispatcher") return s === "delivered";
    if (role === "billing") return s === "paid" || s === "billed";
    return role === "owner" || role === "processor";
  });
}
export const canEditJobs = (r: Role) => r === "owner" || r === "processor";
export const canEditClients = (r: Role) => r === "owner" || r === "processor" || r === "billing";
