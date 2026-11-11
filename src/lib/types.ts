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
  "bill_of_lading", "airway_bill", "commercial_invoice", "packing_list", "sps_import_clearance", "permit", "entry",
  "assessment", "payment_proof", "release", "delivery_receipt", "billing_statement", "other",
] as const;
/** Client that new shipments sit under until a consignee has been read. Keep in sync with scan-job/assemble.ts. */
export const PLACEHOLDER_CLIENT = "Unassigned (to be confirmed)";
export const pretty = (s: string) =>
  s === "sps_import_clearance" ? "SPS import clearance" : s.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

export type Profile = { id: string; email: string | null; full_name: string; role: Role; created_at: string };
export type Client = {
  id: string; name: string; tin: string | null; address: string | null;
  contact_person: string | null; email: string | null; phone: string | null;
};
export type Job = {
  id: string; job_no: string; client_id: string; service_type: ServiceType; status: JobStatus;
  bl_awb_no: string | null; containers: string[]; vessel: string | null; voyage: string | null;
  eta: string | null; port_of_discharge: string | null; booking_no: string | null; carrier: string | null;
  entry_no: string | null; processor_id: string | null; notes: string | null;
  created_at: string; updated_at: string;
  clients?: { name: string } | null;
  processor?: { full_name: string; email: string | null } | null;
};
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
