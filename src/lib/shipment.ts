// Shipment details worked out from what the scan read in a job's documents.
// One uploaded file can hold several documents ("parts").
type Fields = Record<string, unknown>;
export type DocLike = { doc_type: string; extracted: Record<string, unknown> | null };
export type Part = { type: string; fields: Fields };

const TRANSPORT = ["bill_of_lading", "airway_bill"];
const CORE = [...TRANSPORT, "commercial_invoice", "packing_list"];

export function partsOf(d: DocLike): Part[] {
  if (!d.extracted) return [];
  const raw = Array.isArray(d.extracted.parts) ? (d.extracted.parts as Fields[]) : [d.extracted as Fields];
  return raw.map((fields) => ({
    // A single-document file keeps the type its uploader chose; otherwise use what was detected.
    type: raw.length === 1 && d.doc_type !== "other" ? d.doc_type : ((fields.doc_type_detected as string) ?? d.doc_type),
    fields,
  }));
}

const has = (v: unknown) => (Array.isArray(v) ? v.length > 0 : v != null && v !== "");

function first(parts: Part[], get: (f: Fields) => unknown, types = CORE): unknown {
  for (const t of types) {
    for (const p of parts) {
      if (p.type !== t) continue;
      const v = get(p.fields);
      if (has(v)) return v;
    }
  }
  return null;
}
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const party = (k: string) => (f: Fields) => (f[k] as { name?: string } | null)?.name;

export type Shipment = {
  shipper: string | null; consignee: string | null; blNo: string | null; bookingNo: string | null;
  vessel: string | null; voyage: string | null; portOfLoading: string | null; portOfDischarge: string | null;
  containers: string[]; packages: number | null; packageType: string | null;
  grossWeight: number | null; weightUnit: string | null; goods: string | null;
  invoiceNos: string[]; currency: string | null; invoiceTotal: number | null;
  /** Set when invoices are in different currencies, so they cannot be added up. */
  invoiceTotalsText: string | null;
};

export function summarize(docs: DocLike[]): Shipment {
  const parts = docs.flatMap(partsOf);
  const containerSet = (types: string[]) => [
    ...new Set(
      parts.filter((p) => types.includes(p.type))
        .flatMap((p) => (Array.isArray(p.fields.container_numbers) ? (p.fields.container_numbers as string[]) : []))
        .map((c) => String(c).toUpperCase().replace(/[^A-Z0-9]/g, ""))
        .filter(Boolean),
    ),
  ];
  const transportContainers = containerSet(TRANSPORT);

  // Invoices: one line per invoice number, so a file uploaded twice is not counted twice.
  const seen = new Set<string>();
  const invoices: { no: string | null; currency: string | null; total: number | null }[] = [];
  for (const p of parts) {
    if (p.type !== "commercial_invoice") continue;
    const no = str(p.fields.invoice_number) ?? str(p.fields.document_number);
    const key = no ? no.toUpperCase().replace(/[^A-Z0-9]/g, "") : `#${invoices.length}`;
    if (seen.has(key)) continue;
    seen.add(key);
    invoices.push({ no, currency: str(p.fields.currency)?.toUpperCase() ?? null, total: num(p.fields.invoice_total) });
  }
  const withTotal = invoices.filter((i) => i.total != null);
  const currencies = [...new Set(withTotal.map((i) => i.currency ?? ""))];
  const single = currencies.length <= 1;

  return {
    shipper: str(first(parts, party("shipper"))),
    consignee: str(first(parts, party("consignee"))),
    blNo: str(first(parts, (f) => f.bl_awb_number, TRANSPORT)),
    bookingNo: str(first(parts, (f) => f.booking_number)),
    vessel: str(first(parts, (f) => f.vessel, TRANSPORT)),
    voyage: str(first(parts, (f) => f.voyage, TRANSPORT)),
    portOfLoading: str(first(parts, (f) => f.port_of_loading, TRANSPORT)),
    portOfDischarge: str(first(parts, (f) => f.port_of_discharge, TRANSPORT)),
    containers: transportContainers.length ? transportContainers : containerSet(CORE),
    packages: num(first(parts, (f) => f.package_count)),
    packageType: str(first(parts, (f) => (num(f.package_count) != null ? f.package_type : null))),
    grossWeight: num(first(parts, (f) => f.gross_weight)),
    weightUnit: str(first(parts, (f) => (num(f.gross_weight) != null ? f.weight_unit : null))),
    goods: str(first(parts, (f) => f.goods_description)),
    invoiceNos: invoices.map((i) => i.no).filter((n): n is string => !!n),
    currency: single ? (currencies[0] || null) : null,
    invoiceTotal: single && withTotal.length ? Math.round(withTotal.reduce((s, i) => s + i.total!, 0) * 100) / 100 : null,
    invoiceTotalsText: single ? null : withTotal.map((i) => `${i.currency ?? "?"} ${i.total!.toLocaleString()}`).join(" + "),
  };
}

/** Label/value pairs for display, skipping anything not found. */
export function summaryRows(s: Shipment): [string, string][] {
  const n = (v: number) => v.toLocaleString();
  const rows: [string, string | null][] = [
    ["Shipper", s.shipper],
    ["Consignee", s.consignee],
    ["BL / AWB no.", s.blNo],
    ["Vessel / voyage", [s.vessel, s.voyage].filter(Boolean).join(" / ") || null],
    ["Port of loading", s.portOfLoading],
    ["Port of discharge", s.portOfDischarge],
    ["Containers", s.containers.join(", ") || null],
    ["Packages", s.packages == null ? null : `${n(s.packages)} ${s.packageType ?? ""}`.trim()],
    ["Gross weight", s.grossWeight == null ? null : `${n(s.grossWeight)} ${s.weightUnit ?? ""}`.trim()],
    ["Goods", s.goods],
    ["Invoice no.", s.invoiceNos.join(", ") || null],
    ["Invoice total", s.invoiceTotal != null ? `${s.currency ?? ""} ${n(s.invoiceTotal)}`.trim() : s.invoiceTotalsText],
  ];
  return rows.filter((r): r is [string, string] => !!r[1]);
}
