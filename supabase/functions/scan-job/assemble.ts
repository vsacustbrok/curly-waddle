// Pure helpers that turn extracted file contents into cross-check inputs and
// into values for the job record. No I/O here, so everything is unit-tested.
import { nameTokens, normContainer, type DocInput, type Extracted } from "./crosscheck.ts";

/** Transport documents: any of these is "the bill of lading" for the checks. */
export const TRANSPORT_TYPES = ["bill_of_lading", "seaway_bill", "telex_release", "airway_bill"];
/** Commercial documents whose goods, parties and amounts are compared with the transport document. */
export const COMMERCIAL_TYPES = ["commercial_invoice", "sales_contract", "purchase_order", "packing_list"];
export const CORE_TYPES = [...TRANSPORT_TYPES, ...COMMERCIAL_TYPES];
/** Documents that take part in the checks: the shipping documents plus SPS import clearances. */
const CHECKED_TYPES = [...CORE_TYPES, "sps_import_clearance", "arrival_notice"];
const isoDate = (v: unknown): string | null => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) ? v : null);

/** Shipping lines by the four-letter prefix of their bill of lading numbers. */
const BL_PREFIX_CARRIER: Record<string, string> = {
  MAEU: "Maersk", MEDU: "MSC", CMDU: "CMA CGM", COSU: "COSCO", EGLV: "Evergreen", HLCU: "Hapag-Lloyd",
  ONEY: "ONE (Ocean Network Express)", OOLU: "OOCL", YMLU: "Yang Ming", ZIMU: "ZIM", HDMU: "HMM", WHLC: "Wan Hai",
  SITC: "SITC", APLU: "APL", SMLM: "SM Line", KMTC: "KMTC",
};
const TRANSPORT = TRANSPORT_TYPES;
/** Client that new shipments sit under until a consignee has been read. Keep in sync with src/lib/types.ts. */
export const PLACEHOLDER_CLIENT = "Unassigned (to be confirmed)";

export type DocRow = { id: string; doc_type: string; file_name: string; extracted: unknown };

/** One uploaded file can hold several documents; each is a "part". */
export function partsOf(extracted: unknown): Extracted[] {
  if (!extracted || typeof extracted !== "object") return [];
  const parts = (extracted as { parts?: unknown }).parts;
  if (Array.isArray(parts)) return parts as Extracted[];
  return [extracted as Extracted]; // rows saved before files could have parts
}

/** The type to file an upload under: the most important document found in it. */
export function primaryType(parts: Extracted[]): string | null {
  for (const t of CHECKED_TYPES) if (parts.some((p) => p.doc_type_detected === t)) return t;
  return parts[0]?.doc_type_detected ?? null;
}

/**
 * Every BL / AWB, invoice, packing list and SPS clearance found in the files, as check inputs.
 * Pass types = null to get every document, including certificates and other papers.
 */
export function toDocInputs(rows: DocRow[], types: string[] | null = CHECKED_TYPES): DocInput[] {
  const out: DocInput[] = [];
  for (const r of rows) {
    const parts = partsOf(r.extracted);
    parts.forEach((p, i) => {
      // A single-document file keeps the type its uploader chose; otherwise use what was detected.
      const type = parts.length === 1 && r.doc_type !== "other" ? r.doc_type : (p.doc_type_detected ?? r.doc_type);
      if (types && !types.includes(type)) return;
      out.push({
        id: `${r.id}#${i}`,
        file_name: parts.length > 1 ? `${r.file_name} (document ${i + 1} of ${parts.length})` : r.file_name,
        doc_type: type,
        extracted: p,
      });
    });
  }
  return out;
}

const has = (v: unknown) => (Array.isArray(v) ? v.length > 0 : v != null && v !== "");

function first<T>(docs: DocInput[], get: (e: Extracted) => T | null | undefined, types = CORE_TYPES): T | null {
  for (const t of types) {
    for (const d of docs) {
      if (d.doc_type !== t || !d.extracted) continue;
      const v = get(d.extracted);
      if (has(v)) return v as T;
    }
  }
  return null;
}

export type JobFields = {
  bl_awb_no: string | null;
  booking_no: string | null;
  vessel: string | null;
  voyage: string | null;
  port_of_discharge: string | null;
  containers: string[] | null;
  eta: string | null;
  carrier: string | null;
  item_description?: string | null;
  bl_release_type?: string | null;
};

/** Where to look for the ETA and carrier: the arrival notice first, then the transport document, then the rest. */
const ARRIVAL_FIRST = ["arrival_notice", ...TRANSPORT, "commercial_invoice", "packing_list"];

/** The ETA printed on the documents, preferring the arrival notice. */
export function etaOf(docs: DocInput[]): { date: string; source: string } | null {
  for (const t of ARRIVAL_FIRST) {
    for (const d of docs) {
      const date = d.doc_type === t ? isoDate(d.extracted?.eta_date) : null;
      if (date) return { date, source: `${d.doc_type}: ${d.file_name}` };
    }
  }
  return null;
}

/** Values to copy into job fields that are still empty. Never overwrites what is already there. */
export function jobPatch(job: JobFields, docs: DocInput[]): Partial<JobFields> {
  const patch: Record<string, unknown> = {};
  const fill = (col: keyof JobFields, v: unknown) => {
    if (!has(job[col]) && has(v)) patch[col] = v;
  };
  fill("bl_awb_no", first(docs, (e) => e.bl_awb_number, TRANSPORT));
  fill("booking_no", first(docs, (e) => e.booking_number));
  fill("vessel", first(docs, (e) => e.vessel, TRANSPORT));
  fill("voyage", first(docs, (e) => e.voyage, TRANSPORT));
  fill("port_of_discharge", first(docs, (e) => e.port_of_discharge, TRANSPORT));
  const containersFrom = (types: string[]) => [
    ...new Set(
      docs.filter((d) => types.includes(d.doc_type))
        .flatMap((d) => d.extracted?.container_numbers ?? [])
        .map(normContainer)
        .filter(Boolean),
    ),
  ];
  const transport = containersFrom(TRANSPORT);
  fill("containers", transport.length ? transport : containersFrom(CORE_TYPES));
  fill("eta", etaOf(docs)?.date);
  const blNo = (first(docs, (e) => e.bl_awb_number, TRANSPORT) ?? job.bl_awb_no ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  fill("carrier", first(docs, (e) => e.carrier_name, ["arrival_notice", ...TRANSPORT]) ?? BL_PREFIX_CARRIER[blNo.slice(0, 4)]);
  // The goods as the transport document describes them, else the invoice's.
  fill("item_description", first(docs, (e) => e.goods_description, TRANSPORT) ?? first(docs, (e) => e.goods_description, ["commercial_invoice"]));
  // A telex-released BL or a sea waybill also tells how the BL is released.
  if ("bl_release_type" in job) {
    fill("bl_release_type", docs.some((d) => d.doc_type === "telex_release") ? "telex" : docs.some((d) => d.doc_type === "seaway_bill") ? "seaway" : null);
  }
  return patch as Partial<JobFields>;
}

/** The consignee to use as the client, preferring the transport document. */
export function consigneeOf(docs: DocInput[]): { name: string; address: string | null } | null {
  const c = first(docs, (e) => (e.consignee?.name ? e.consignee : null));
  return c?.name ? { name: c.name.trim(), address: c.address ?? null } : null;
}

/** True when two company names are the same apart from case, punctuation and suffixes like Inc. or Corp. */
export function sameCompany(a: string, b: string): boolean {
  const ta = nameTokens(a);
  const tb = nameTokens(b);
  if (ta.size === 0 || ta.size !== tb.size) return false;
  for (const t of ta) if (!tb.has(t)) return false;
  return true;
}
