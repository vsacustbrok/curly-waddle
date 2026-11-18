// Shared pieces of the Pre-Lodgment Audit screen: the lists the brokers pick from, the stage names,
// and the export of the checked shipment for VASP encoding.
import type { Issue, Job, JobDocument } from "./types";

export const STAGES = ["Documents complete", "Numbers match", "Permits and dates", "HS codes and description", "Other checks"];
/** Fallback for audits saved before issues carried their stage. */
export function stageOf(i: Issue): number {
  if (i.stage != null) return i.stage;
  if (/^(completeness|documents_present|extraction)$/.test(i.check)) return 0;
  if (/(weight|package|container|seal|tin|consignee|shipper|notify|bl_number|invoice|currency|freight|insurance|dutiable|bank|volume|address|contact)/.test(i.check)) return 1;
  if (/(sps|permit|mav|expiry|validity|eta|ship_out)/.test(i.check)) return 2;
  if (/(hs_code|goods|description|incoterm|origin|dangerous)/.test(i.check)) return 3;
  return 4;
}

export const PORTS = [
  "Manila International Container Port (MICP)", "Port of Manila (POM / South Harbor)", "NAIA (Ninoy Aquino International Airport)",
  "Port of Subic", "Port of Batangas", "Port of Cebu", "Port of Davao", "Port of Cagayan de Oro", "Port of Iloilo", "Clark",
];
export const VASPS = ["Intercommerce Network Services (INS)", "E-Konek Pilipinas", "Cargo Data Exchange Center (CDEC)"];
export const CURRENCIES = ["USD", "EUR", "JPY", "CNY", "AUD", "SGD", "HKD", "GBP", "KRW", "THB", "PHP"];

/** Extra documents a shipment may need, as ticks. Keys match scan-job/audit.ts REQUIRED_DOC_TYPES. */
export const REQUIRED_CHOICES: [string, string][] = [
  ["sps_import_clearance", "SPS import clearance"], ["mav_certificate", "MAV certificate"], ["fda_permit", "FDA permit"],
  ["peza_permit", "PEZA permit"], ["agency_permit", "Other agency permit (BPS, NTC, DENR, PDEA, FPA, SRA…)"],
  ["certificate_of_origin", "Certificate of origin (FTA rate)"], ["health_certificate", "Health / veterinary certificate"],
  ["phytosanitary_certificate", "Phytosanitary certificate"], ["halal_certificate", "Halal certificate"],
  ["fumigation_certificate", "Fumigation certificate"], ["insurance_certificate", "Insurance certificate"],
  ["bank_document", "Bank document (L/C, D/P, D/A)"], ["importer_accreditation", "Importer accreditation"],
  ["container_list", "Container / seal list"],
];

type Part = Record<string, unknown> & { doc_type_detected?: string };
/** Every document read from the shipment's files, with the type it is filed under. */
export function partsOf(docs: JobDocument[]): { type: string; file: string; p: Part }[] {
  return docs.flatMap((d) => {
    const parts = ((d.extracted as { parts?: Part[] } | null)?.parts ?? []);
    return parts.map((p) => ({ type: parts.length === 1 && d.doc_type !== "other" ? d.doc_type : (p.doc_type_detected ?? d.doc_type), file: d.file_name, p }));
  });
}
const TRANSPORT = ["bill_of_lading", "seaway_bill", "telex_release", "airway_bill"];
const ORDER = [...TRANSPORT, "commercial_invoice", "packing_list", "container_list", "certificate_of_origin"];
/** The first value found for a field, looking at the transport document first, then the invoice, then the rest. */
export function firstValue<T = unknown>(parts: ReturnType<typeof partsOf>, field: string, types: string[] = ORDER): T | null {
  for (const t of types) for (const x of parts) {
    if (x.type !== t) continue;
    const v = x.p[field];
    if (v != null && v !== "" && !(Array.isArray(v) && v.length === 0)) return v as T;
  }
  return null;
}
const uniq = (vals: unknown[]) => [...new Set(vals.flat().filter(Boolean).map(String))];

export type Line = { description: string | null; hs_code: string | null; quantity: number | null; unit_price: number | null; amount: number | null; currency: string | null; file_name: string };

/** Invoice total + freight + insurance + other charges, in the invoice currency and in pesos. */
export function dutiableValue(job: Job, parts: ReturnType<typeof partsOf>) {
  const invoice = firstValue<number>(parts, "invoice_total", ["commercial_invoice"]);
  const freight = job.freight_amount ?? firstValue<number>(parts, "freight_amount");
  const insurance = job.insurance_amount ?? firstValue<number>(parts, "insurance_amount");
  const other = job.other_charges ?? 0;
  const currency = job.charges_currency || firstValue<string>(parts, "currency", ["commercial_invoice"]) || "";
  if (invoice == null) return null;
  const total = Number(invoice) + Number(freight ?? 0) + Number(insurance ?? 0) + Number(other ?? 0);
  return { invoice: Number(invoice), freight, insurance, other, currency, total, php: job.exchange_rate ? total * Number(job.exchange_rate) : null };
}

/** The shipment as one flat record, ready for VASP encoding. */
export function exportRecord(job: Job, docs: JobDocument[], light: string | null, approval: { approved_by_name: string | null; approved_at: string } | null) {
  const parts = partsOf(docs);
  const consignee = firstValue<{ name?: string; tin?: string; address?: string }>(parts, "consignee");
  const shipper = firstValue<{ name?: string; address?: string }>(parts, "shipper");
  const co = parts.find((x) => x.type === "certificate_of_origin");
  const dv = dutiableValue(job, parts);
  return {
    pn: job.job_no,
    consignee: consignee?.name ?? job.clients?.name ?? null,
    consignee_tin: consignee?.tin ?? job.clients?.tin ?? null,
    consignee_address: consignee?.address ?? job.clients?.address ?? null,
    shipper: shipper?.name ?? null,
    bl_awb_no: job.bl_awb_no ?? firstValue(parts, "bl_awb_number", TRANSPORT),
    vessel: job.vessel ?? firstValue(parts, "vessel", TRANSPORT),
    voyage: job.voyage ?? firstValue(parts, "voyage", TRANSPORT),
    port_of_loading: firstValue(parts, "port_of_loading"),
    port_of_discharge: job.port_of_discharge ?? firstValue(parts, "port_of_discharge"),
    port_of_entry: job.port_of_entry ?? null,
    vasp: job.vasp ?? null,
    eta: job.eta,
    containers: (job.containers?.length ? job.containers : uniq(parts.map((x) => x.p.container_numbers as unknown[] ?? []))).join(" "),
    seals: uniq(parts.map((x) => x.p.seal_numbers as unknown[] ?? [])).join(" "),
    packages: firstValue(parts, "package_count"),
    package_type: firstValue(parts, "package_type"),
    gross_weight: firstValue(parts, "gross_weight"),
    net_weight: firstValue(parts, "net_weight", ["packing_list", "commercial_invoice", ...TRANSPORT]),
    weight_unit: firstValue(parts, "weight_unit"),
    volume_cbm: firstValue(parts, "volume_cbm"),
    incoterm: firstValue(parts, "incoterm", ["commercial_invoice"]),
    country_of_origin: firstValue(parts, "country_of_origin"),
    fta_form: co ? String(co.p.notes ?? "").split(/[.;,\n]/)[0].trim() || "Certificate of origin" : null,
    hs_codes: uniq(parts.filter((x) => x.type === "commercial_invoice").map((x) => x.p.hs_codes as unknown[] ?? [])).join(" "),
    currency: dv?.currency ?? null,
    invoice_total: dv?.invoice ?? null,
    freight: dv?.freight ?? null,
    insurance: dv?.insurance ?? null,
    other_charges: dv?.other ?? null,
    dutiable_value: dv?.total ?? null,
    exchange_rate: job.exchange_rate ?? null,
    dutiable_value_php: dv?.php != null ? Math.round(dv.php * 100) / 100 : null,
    audit_status: approval ? "APPROVED_FOR_LODGMENT" : light ? light.toUpperCase() : "NOT_AUDITED",
    approved_by: approval?.approved_by_name ?? null,
    approved_at: approval?.approved_at ?? null,
  };
}

const csvCell = (v: unknown) => {
  const t = v == null ? "" : String(v);
  return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};
export function toCsv(record: Record<string, unknown>, lines: Line[]): string {
  const keys = Object.keys(record);
  const lineKeys: (keyof Line)[] = ["description", "hs_code", "quantity", "unit_price", "amount", "currency", "file_name"];
  return [
    keys.join(","), keys.map((k) => csvCell(record[k])).join(","), "",
    ["line_no", ...lineKeys].join(","),
    ...lines.map((l, i) => [i + 1, ...lineKeys.map((k) => l[k])].map(csvCell).join(",")),
  ].join("\n");
}

export function downloadText(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
