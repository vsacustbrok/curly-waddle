// Shipment details worked out from what the scan read in a job's documents.
// One uploaded file can hold several documents ("parts").
type Fields = Record<string, unknown>;
export type DocLike = { doc_type: string; extracted: Record<string, unknown> | null };
export type Part = { type: string; fields: Fields };

const TRANSPORT = ["bill_of_lading", "airway_bill"];
const CORE = [...TRANSPORT, "commercial_invoice", "packing_list"];
const SPS = "sps_import_clearance";
const isoDate = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

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
  /** ISO dates. With several SPS clearances, the must-ship-out date is the earliest one. */
  shippedOnBoard: string | null; spsNos: string[]; spsMustShipOut: string | null; spsQuantity: string | null;
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
  // SPS clearances: one per clearance number.
  const spsSeen = new Set<string>();
  const sps = parts.filter((p) => {
    if (p.type !== SPS) return false;
    const key = (str(p.fields.document_number) ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (key && spsSeen.has(key)) return false;
    if (key) spsSeen.add(key);
    return true;
  });
  const mustShip = sps.map((p) => isoDate(p.fields.sps_must_ship_out_date)).filter((d): d is string => !!d).sort();

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
    shippedOnBoard: isoDate(first(parts, (f) => f.shipped_on_board_date, TRANSPORT)),
    spsNos: sps.map((p) => str(p.fields.document_number)).filter((n): n is string => !!n),
    spsMustShipOut: mustShip[0] ?? null,
    spsQuantity: sps.filter((p) => num(p.fields.sps_permitted_weight) != null)
      .map((p) => `${num(p.fields.sps_permitted_weight)!.toLocaleString()} ${str(p.fields.sps_permitted_weight_unit) ?? ""}`.trim())
      .join(" + ") || null,
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
    ["Shipped on board", s.shippedOnBoard],
    ["Port of loading", s.portOfLoading],
    ["Port of discharge", s.portOfDischarge],
    ["Containers", s.containers.join(", ") || null],
    ["Packages", s.packages == null ? null : `${n(s.packages)} ${s.packageType ?? ""}`.trim()],
    ["Gross weight", s.grossWeight == null ? null : `${n(s.grossWeight)} ${s.weightUnit ?? ""}`.trim()],
    ["Goods", s.goods],
    ["Invoice no.", s.invoiceNos.join(", ") || null],
    ["Invoice total", s.invoiceTotal != null ? `${s.currency ?? ""} ${n(s.invoiceTotal)}`.trim() : s.invoiceTotalsText],
    ["SPS no.", s.spsNos.join(", ") || null],
    ["SPS must ship out", s.spsMustShipOut],
    ["SPS quantity", s.spsQuantity],
  ];
  return rows.filter((r): r is [string, string] => !!r[1]);
}
