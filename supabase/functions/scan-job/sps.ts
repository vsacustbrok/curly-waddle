// Checks of an SPS import clearance (SPSIC) against the bill of lading / airway bill.
// Deterministic, like crosscheck.ts: every decision here is made in code.
import { descTokens, nameSimilarity, toKg, type DocInput, type Extracted, type Issue, type Match } from "./crosscheck.ts";

export const SPS_TYPE = "sps_import_clearance";
const TRANSPORT = ["bill_of_lading", "seaway_bill", "telex_release", "airway_bill"];
const NAME_MATCH = 0.6;
/** The shipment weight may differ from the SPS quantity by at most 3%. Beyond that the SPS must be cancelled or re-applied. */
const WEIGHT_TOLERANCE = 0.03;

const isoDate = (v: string | null | undefined) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) ? v : null);
const label = (d: DocInput) => `${d.doc_type}: ${d.file_name}`;
const kg = (n: number) => `${n.toLocaleString("en-US", { maximumFractionDigits: 2 })} kg`;

/** The shipment weight to hold against the SPS quantity: net weight if any document states it, else gross. */
function shipmentWeight(transport: DocInput, others: DocInput[]): { kg: number; basis: "net" | "gross"; source: string } | null {
  const net = (d: DocInput) => toKg(d.extracted?.net_weight, d.extracted?.weight_unit);
  const tNet = net(transport);
  if (tNet != null && tNet > 0) return { kg: tNet, basis: "net", source: label(transport) };
  for (const d of others) {
    const n = net(d);
    if (n != null && n > 0) return { kg: n, basis: "net", source: label(d) };
  }
  const gross = toKg(transport.extracted?.gross_weight, transport.extracted?.weight_unit);
  return gross != null && gross > 0 ? { kg: gross, basis: "gross", source: label(transport) } : null;
}

export function spsChecks(docs: DocInput[]): { issues: Issue[]; matches: Match[] } {
  const issues: Issue[] = [];
  const matches: Match[] = [];
  const withData = docs.filter((d) => d.extracted);

  // One entry per clearance number, so the same SPS uploaded twice is not counted twice.
  const seen = new Set<string>();
  const spsDocs = withData.filter((d) => {
    if (d.doc_type !== SPS_TYPE) return false;
    const no = (d.extracted!.document_number ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (no && seen.has(no)) return false;
    if (no) seen.add(no);
    return true;
  });
  if (spsDocs.length === 0) return { issues, matches };

  const transports = withData.filter((d) => TRANSPORT.includes(d.doc_type));
  if (transports.length === 0) {
    issues.push({
      severity: "warning",
      check: "sps_vs_bl",
      message: "An SPS import clearance is on file but no Bill of Lading or Airway Bill has been read, so it could not be checked.",
      values: [],
    });
    return { issues, matches };
  }
  const bl = transports[0];
  const b = bl.extracted as Extracted;
  const commercial = withData.filter((d) => d.doc_type === "packing_list" || d.doc_type === "commercial_invoice");

  for (const sps of spsDocs) {
    const s = sps.extracted as Extracted;
    const pair = (a: unknown, c: unknown) => [{ source: label(sps), value: a }, { source: label(bl), value: c }];

    // --- parties and goods ---
    if (s.consignee?.name && b.consignee?.name) {
      if (nameSimilarity(s.consignee.name, b.consignee.name) < NAME_MATCH) {
        issues.push({
          severity: "error",
          check: "sps_consignee_match",
          message: "The importer on the SPS is not the consignee on the bill of lading.",
          values: pair(s.consignee.name, b.consignee.name),
        });
      } else matches.push({ check: "sps_consignee_match", value: s.consignee.name, sources: [label(sps), label(bl)] });
    }
    if (s.shipper?.name && b.shipper?.name) {
      if (nameSimilarity(s.shipper.name, b.shipper.name) < NAME_MATCH) {
        issues.push({
          severity: "warning",
          check: "sps_shipper_match",
          message: "The exporter on the SPS differs from the shipper on the bill of lading. Confirm they are the same supplier.",
          values: pair(s.shipper.name, b.shipper.name),
        });
      } else matches.push({ check: "sps_shipper_match", value: s.shipper.name, sources: [label(sps), label(bl)] });
    }
    const st = descTokens(s.goods_description);
    const bt = descTokens(b.goods_description);
    if (st.size && bt.size) {
      let inter = 0;
      for (const t of st) if (bt.has(t)) inter++;
      if (inter / Math.min(st.size, bt.size) < 0.2) {
        issues.push({
          severity: "warning",
          check: "sps_goods_match",
          message: "The commodity on the SPS shares few words with the goods on the bill of lading. Confirm they are the same goods.",
          values: pair(s.goods_description, b.goods_description),
        });
      } else matches.push({ check: "sps_goods_match", value: [...st].filter((t) => bt.has(t)).slice(0, 8).join(" "), sources: [label(sps), label(bl)] });
    }

    // --- must ship out date ---
    const mustShip = isoDate(s.sps_must_ship_out_date);
    const onBoard = isoDate(b.shipped_on_board_date);
    const issued = isoDate(s.issue_date);
    if (!mustShip) {
      issues.push({
        severity: "warning",
        check: "sps_must_ship_out",
        message: `Could not read a must-ship-out date from ${sps.file_name}. Check it by hand.`,
        values: [],
      });
    } else if (!onBoard) {
      issues.push({
        severity: "warning",
        check: "sps_must_ship_out",
        message: `The bill of lading shows no shipped-on-board date, so it could not be checked against the SPS must-ship-out date (${mustShip}).`,
        values: [{ source: label(sps), value: mustShip }],
      });
    } else if (onBoard > mustShip) {
      issues.push({
        severity: "error",
        check: "sps_must_ship_out",
        message: `Shipped on board ${onBoard}, after the SPS must-ship-out date ${mustShip}.`,
        values: [{ source: `${label(sps)} (must ship out)`, value: mustShip }, { source: `${label(bl)} (shipped on board)`, value: onBoard }],
      });
    } else if (issued && onBoard < issued) {
      issues.push({
        severity: "error",
        check: "sps_must_ship_out",
        message: `Shipped on board ${onBoard}, before the SPS was issued on ${issued}. The shipment is outside the prescribed period.`,
        values: [{ source: `${label(sps)} (issued)`, value: issued }, { source: `${label(bl)} (shipped on board)`, value: onBoard }],
      });
    } else {
      matches.push({
        check: "sps_must_ship_out",
        value: `shipped ${onBoard}, must ship out by ${mustShip}${issued ? `, SPS issued ${issued}` : ""}`,
        sources: [label(sps), label(bl)],
      });
    }
  }

  // --- weight: the shipment against the total quantity of all SPS clearances on the job ---
  const allowed = spsDocs.map((d) => toKg(d.extracted!.sps_permitted_weight, d.extracted!.sps_permitted_weight_unit));
  const spsLabel = spsDocs.map(label).join("; ");
  if (allowed.some((a) => a == null || a <= 0)) {
    issues.push({
      severity: "warning",
      check: "sps_weight",
      message: "Could not read the permitted quantity from every SPS on this shipment. Check the weight by hand.",
      values: spsDocs.map((d) => ({ source: label(d), value: d.extracted!.sps_permitted_weight ?? null })),
    });
    return { issues, matches };
  }
  const limit = (allowed as number[]).reduce((a, c) => a + c, 0);
  const actual = shipmentWeight(bl, commercial);
  if (!actual) {
    issues.push({
      severity: "warning",
      check: "sps_weight",
      message: `No shipment weight could be read to check against the SPS quantity (${kg(limit)}).`,
      values: [{ source: spsLabel, value: kg(limit) }],
    });
    return { issues, matches };
  }
  const values = [
    { source: `${spsLabel} (permitted)`, value: kg(limit) },
    { source: `${actual.source} (${actual.basis} weight)`, value: kg(actual.kg) },
  ];
  const diff = (actual.kg - limit) / limit;
  const pct = `${(Math.abs(diff) * 100).toFixed(2)}%`;
  if (diff > WEIGHT_TOLERANCE) {
    issues.push(actual.basis === "net"
      ? {
        severity: "error",
        check: "sps_weight",
        message: `Net weight ${kg(actual.kg)} exceeds the SPS permitted quantity ${kg(limit)} by ${kg(actual.kg - limit)} (${pct}), beyond the 3% tolerance. The SPS must be cancelled or re-applied.`,
        values,
      }
      : {
        severity: "warning",
        check: "sps_weight",
        message: `No net weight was found. Gross weight ${kg(actual.kg)} is ${pct} above the SPS permitted quantity ${kg(limit)}; confirm the net weight is within the 3% tolerance.`,
        values,
      });
  } else if (diff < -WEIGHT_TOLERANCE) {
    issues.push({
      severity: "warning",
      check: "sps_weight",
      message: `The ${actual.basis} weight ${kg(actual.kg)} is ${kg(limit - actual.kg)} (${pct}) below the SPS permitted quantity ${kg(limit)}, outside the 3% tolerance. Check whether the SPS needs to be cancelled or re-applied.`,
      values,
    });
  } else {
    matches.push({
      check: "sps_weight",
      value: `${kg(actual.kg)} ${actual.basis} against ${kg(limit)} permitted (${diff === 0 ? "exact" : `${pct} ${diff > 0 ? "over" : "under"}`}, within the 3% tolerance)`,
      sources: [spsLabel, actual.source],
    });
  }
  return { issues, matches };
}
