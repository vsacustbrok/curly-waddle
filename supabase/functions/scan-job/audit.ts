// Pre-lodgment audit: the extra checks a licensed broker runs before lodging an entry with the BOC,
// on top of crosscheck.ts, sps.ts and extra.ts. Deterministic: every decision is made in code.
//
// Stage 1 completeness, stage 2 numbers, stage 3 permits and dates, stage 4 HS codes. Each issue also
// carries a plain fix suggestion, and the whole result gets a traffic light.
import { toKg, type DocInput, type Extracted, type Issue, type Match } from "./crosscheck.ts";

export const TRANSPORT = ["bill_of_lading", "seaway_bill", "telex_release", "airway_bill"];
/** Documents whose expiry date (sps_valid_until) matters before lodgment. */
export const PERMIT_TYPES = [
  "sps_import_clearance", "mav_certificate", "fda_permit", "peza_permit", "agency_permit", "health_certificate",
  "phytosanitary_certificate", "halal_certificate", "fumigation_certificate", "importer_accreditation", "permit",
];
/** Extra documents staff can mark as required on a shipment, and the document types that satisfy each. */
export const REQUIRED_DOC_TYPES: Record<string, string[]> = {
  sps_import_clearance: ["sps_import_clearance"],
  mav_certificate: ["mav_certificate"],
  fda_permit: ["fda_permit"],
  peza_permit: ["peza_permit"],
  agency_permit: ["agency_permit", "permit"],
  health_certificate: ["health_certificate"],
  phytosanitary_certificate: ["phytosanitary_certificate"],
  halal_certificate: ["halal_certificate"],
  fumigation_certificate: ["fumigation_certificate"],
  certificate_of_origin: ["certificate_of_origin"],
  insurance_certificate: ["insurance_certificate"],
  bank_document: ["bank_document"],
  importer_accreditation: ["importer_accreditation"],
  container_list: ["container_list"],
};
/** Goods that normally need an SPS import clearance (food of animal or plant origin). */
const SPS_GOODS = /\b(frozen|chilled|meat|beef|pork|chicken|poultry|turkey|duck|mutton|lamb|offal|fish|seafood|shrimp|squid|crab|prawn|dairy|milk|cheese|egg|fruit|vegetable|onion|garlic|potato|carrot|plant|seed|rice|corn|grain|flour|soybean|feed)s?\b/i;

export type AuditJob = {
  item_description?: string | null;
  required_docs?: string[] | null;
  freight_amount?: number | null;
  insurance_amount?: number | null;
  charges_currency?: string | null;
};

const label = (d: DocInput) => `${d.doc_type}: ${d.file_name}`;
const kgText = (n: number) => `${n.toLocaleString("en-US", { maximumFractionDigits: 2 })} kg`;
const digits = (v: string | null | undefined) => (v ?? "").replace(/\D/g, "");
const norm = (v: string) => v.toUpperCase().replace(/[^A-Z0-9]/g, "");
const iso = (v: string | null | undefined) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) ? v : null);
function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(to + "T00:00:00Z") - Date.parse(from + "T00:00:00Z")) / 86_400_000);
}
const pretty = (t: string) => t.replace(/_/g, " ");

export function auditChecks(job: AuditJob, docs: DocInput[], today: string): { issues: Issue[]; matches: Match[] } {
  const issues: Issue[] = [];
  const matches: Match[] = [];
  const read = docs.filter((d) => d.extracted);
  const e = (d: DocInput) => d.extracted as Extracted;
  const has = (types: string[]) => read.some((d) => types.includes(d.doc_type));
  const red = (check: string, message: string, values: Issue["values"] = []) => issues.push({ severity: "error", check, message, values });
  const yellow = (check: string, message: string, values: Issue["values"] = []) => issues.push({ severity: "warning", check, message, values });

  // ---------- stage 1: completeness ----------
  const air = read.some((d) => d.doc_type === "airway_bill");
  const core: [string, string[]][] = [
    [air ? "Air waybill" : "Bill of lading (original, seaway, telex or air waybill)", TRANSPORT],
    ["Commercial invoice", ["commercial_invoice"]],
    ["Packing list", ["packing_list"]],
  ];
  for (const t of job.required_docs ?? []) {
    const types = REQUIRED_DOC_TYPES[t];
    if (types) core.push([pretty(t).replace(/^./, (c) => c.toUpperCase()), types]);
  }
  const goods = [job.item_description, ...read.map((d) => e(d).goods_description)].filter(Boolean).join(" ");
  if (SPS_GOODS.test(goods) && !(job.required_docs ?? []).includes("sps_import_clearance")) {
    core.push(["SPS import clearance (the goods look like food of animal or plant origin)", ["sps_import_clearance"]]);
  }
  const missing = core.filter(([, types]) => !has(types)).map(([name]) => name);
  if (missing.length) {
    red("completeness", `Missing or unreadable: ${missing.join("; ")}. Do not lodge until these are on file.`,
      missing.map((m) => ({ source: "required document", value: m })));
  } else {
    matches.push({ check: "completeness", value: `${core.length} of ${core.length} required documents on file`, sources: core.map(([n]) => n) });
  }

  // ---------- stage 2: numbers ----------
  // Seal numbers: the transport document against the container list (and any other document that lists seals).
  {
    const sets = read.map((d) => ({ d, set: new Set((e(d).seal_numbers ?? []).map(norm).filter(Boolean)) })).filter((x) => x.set.size);
    if (sets.length >= 2) {
      const base = sets[0];
      const off = sets.slice(1).filter((x) => x.set.size !== base.set.size || [...x.set].some((s) => !base.set.has(s)));
      const values = sets.map((x) => ({ source: label(x.d), value: [...x.set].sort().join(", ") }));
      if (off.length) red("seal_numbers_match", "Seal numbers differ between documents.", values);
      else matches.push({ check: "seal_numbers_match", value: [...base.set].sort().join(", "), sources: sets.map((x) => label(x.d)) });
    }
  }
  // Consignee TIN.
  {
    const tins = read.map((d) => ({ source: label(d), value: digits(e(d).consignee?.tin) })).filter((v) => v.value.length >= 9);
    if (tins.length >= 2) {
      const base = tins[0].value.slice(0, 9);
      if (tins.slice(1).some((t) => t.value.slice(0, 9) !== base)) red("consignee_tin_match", "The consignee's TIN differs between documents.", tins);
      else matches.push({ check: "consignee_tin_match", value: tins[0].value, sources: tins.map((t) => t.source) });
    }
  }
  // Freight and insurance for the dutiable value.
  for (const [field, name] of [["freight_amount", "Freight"], ["insurance_amount", "Insurance"]] as const) {
    const entered = job[field];
    const onDocs = read.map((d) => ({ source: label(d), value: e(d)[field] })).filter((v) => v.value != null && (v.value as number) > 0);
    if (entered != null && entered > 0 && onDocs.length) {
      const off = onDocs.filter((v) => Math.abs((v.value as number) - entered) / entered > 0.01);
      if (off.length) {
        yellow(`${field}_match`, `${name} entered for the dutiable value (${entered.toLocaleString("en-US")} ${job.charges_currency ?? ""}) differs from the documents.`.replace(" )", ")"),
          [{ source: "job: " + name.toLowerCase(), value: entered }, ...off]);
      } else matches.push({ check: `${field}_match`, value: entered, sources: ["job: " + name.toLowerCase(), ...onDocs.map((v) => v.source)] });
    }
  }
  {
    const terms = read.map((d) => (e(d).incoterm ?? "").toUpperCase()).join(" ");
    if (/\b(EXW|FCA|FAS|FOB)\b/.test(terms) && !(job.freight_amount && job.freight_amount > 0) && !read.some((d) => e(d).freight_amount)) {
      yellow("dutiable_value", "The goods were bought FOB (or similar), but no freight amount is entered. Freight is needed to work out the dutiable value.");
    }
  }
  // Letter of credit or bank documents against the invoice.
  {
    const invoices = read.filter((d) => d.doc_type === "commercial_invoice" && e(d).invoice_total != null);
    for (const b of read.filter((d) => d.doc_type === "bank_document" && e(d).invoice_total != null)) {
      for (const inv of invoices) {
        const a = e(b).invoice_total!, i = e(inv).invoice_total!;
        const cb = (e(b).currency ?? "").toUpperCase(), ci = (e(inv).currency ?? "").toUpperCase();
        if ((cb && ci && cb !== ci) || Math.abs(a - i) / Math.max(a, i) > 0.01) {
          yellow("bank_vs_invoice", `The amount on ${b.file_name} (${cb} ${a}) does not match the invoice ${inv.file_name} (${ci} ${i}).`,
            [{ source: label(b), value: `${cb} ${a}` }, { source: label(inv), value: `${ci} ${i}` }]);
        } else matches.push({ check: "bank_vs_invoice", value: `${ci} ${i}`, sources: [label(b), label(inv)] });
      }
    }
  }

  // ---------- stage 3: permits and dates ----------
  for (const d of read.filter((x) => PERMIT_TYPES.includes(x.doc_type))) {
    const until = iso(e(d).sps_valid_until);
    if (!until) continue;
    const left = daysBetween(today, until);
    const what = `${pretty(d.doc_type)} ${e(d).document_number ?? d.file_name}`;
    if (left < 0) red("permit_expiry", `The ${what} expired on ${until}. It must be renewed or replaced before lodgment.`, [{ source: label(d), value: until }]);
    else if (left <= 5) yellow("permit_expiry", `The ${what} expires on ${until}, in ${left} day${left === 1 ? "" : "s"}. Lodge before then or renew it.`, [{ source: label(d), value: until }]);
    else matches.push({ check: "permit_expiry", value: `${what} valid until ${until}`, sources: [label(d)] });
  }
  // Must-ship-out: shipped close to the deadline is allowed but worth a second look.
  {
    const onBoard = read.filter((d) => TRANSPORT.includes(d.doc_type)).map((d) => iso(e(d).shipped_on_board_date)).find(Boolean);
    for (const s of read.filter((d) => d.doc_type === "sps_import_clearance")) {
      const mso = iso(e(s).sps_must_ship_out_date);
      if (onBoard && mso && onBoard <= mso && daysBetween(onBoard, mso) <= 2) {
        yellow("sps_ship_out_margin", `Shipped on board ${onBoard}, only ${daysBetween(onBoard, mso)} day(s) before the SPS must-ship-out date ${mso}. Confirm the on-board date against the vessel departure.`,
          [{ source: label(s), value: mso }]);
      }
    }
  }
  // MAV: the shipment's net weight against the quantity allocated.
  {
    const mav = read.filter((d) => d.doc_type === "mav_certificate")
      .map((d) => ({ d, kg: toKg(e(d).sps_permitted_weight, e(d).sps_permitted_weight_unit) })).filter((m) => m.kg != null && m.kg > 0);
    if (mav.length) {
      const allowed = mav.reduce((a, m) => a + m.kg!, 0);
      const net = read.filter((d) => ["commercial_invoice", "packing_list", ...TRANSPORT].includes(d.doc_type))
        .map((d) => ({ d, kg: toKg(e(d).net_weight, e(d).weight_unit) })).find((x) => x.kg != null && x.kg > 0);
      if (!net) yellow("mav_quantity", `No net weight was found to check against the MAV allocation (${kgText(allowed)}).`);
      else if (net.kg! > allowed) {
        red("mav_quantity", `Net weight ${kgText(net.kg!)} is above the MAV allocation ${kgText(allowed)} by ${kgText(net.kg! - allowed)}. The excess is not covered by MAV.`,
          [{ source: mav.map((m) => label(m.d)).join("; "), value: kgText(allowed) }, { source: label(net.d), value: kgText(net.kg!) }]);
      } else matches.push({ check: "mav_quantity", value: `${kgText(net.kg!)} within ${kgText(allowed)} allocated`, sources: [...mav.map((m) => label(m.d)), label(net.d)] });
    }
  }

  // ---------- stage 4: HS / AHTN codes ----------
  {
    const six = (c: string | null | undefined) => digits(c).slice(0, 6);
    const invoiceCodes = new Set(read.filter((d) => d.doc_type === "commercial_invoice")
      .flatMap((d) => [...(e(d).hs_codes ?? []), ...(e(d).line_items ?? []).map((l) => l.hs_code ?? "")]).map(six).filter((c) => c.length === 6));
    for (const d of read.filter((x) => x.doc_type === "certificate_of_origin" || PERMIT_TYPES.includes(x.doc_type))) {
      const codes = new Set((e(d).hs_codes ?? []).map(six).filter((c) => c.length === 6));
      if (!codes.size || !invoiceCodes.size) continue;
      const shared = [...codes].filter((c) => invoiceCodes.has(c));
      const values = [{ source: "commercial invoice", value: [...invoiceCodes].sort().join(", ") }, { source: label(d), value: [...codes].sort().join(", ") }];
      if (!shared.length) {
        (d.doc_type === "certificate_of_origin" ? red : yellow)("hs_code_permits",
          d.doc_type === "certificate_of_origin"
            ? `The HS codes on ${d.file_name} do not match the invoice. The preferential (FTA) duty rate may be refused.`
            : `The HS codes on the ${pretty(d.doc_type)} ${d.file_name} do not match the invoice. Confirm the permit covers these goods.`, values);
      } else matches.push({ check: "hs_code_permits", value: shared.join(", "), sources: values.map((v) => v.source) });
    }
  }

  return { issues, matches };
}

// ---------- stage, fix suggestion and traffic light ----------

export const STAGES = ["Documents complete", "Numbers match", "Permits and dates", "HS codes and description", "Other checks"] as const;
const STAGE_OF: [RegExp, number][] = [
  [/^(completeness|documents_present|extraction)$/, 0],
  [/(weight|package|container|seal|tin|consignee|shipper|notify|bl_number|invoice_total|invoice_line|currency|freight|insurance|dutiable|bank_vs|volume|address|contact)/, 1],
  [/(sps|permit|mav|expiry|validity|eta|ship_out)/, 2],
  [/(hs_code|goods|description|incoterm|origin|dangerous)/, 3],
];
export const stageOf = (check: string) => STAGE_OF.find(([re]) => re.test(check))?.[1] ?? 4;

const FIX: [RegExp, string][] = [
  [/^completeness$/, "Ask the client or shipper for the missing documents and upload them, then run the audit again."],
  [/^extraction$/, "Upload a clearer scan (flat, straight, whole page) and run the audit again."],
  [/gross_weight|net_weight|package_count|volume/, "Ask the shipper for an amended packing list or invoice, or confirm whether pallet or tare weight explains the difference."],
  [/containers_match|seal_numbers|container_check_digit/, "Check the numbers against the container itself or the carrier's records, and ask for corrected documents."],
  [/bl_number/, "Check the BL / AWB number in the project details against the original bill of lading."],
  [/consignee_tin|consignee_match|consignee_vs_client|consignee_address/, "Confirm the importer's name, TIN and address with the client; documents must match the BOC accreditation."],
  [/shipper|notify/, "Confirm the parties with the client; ask the shipper to correct the document if needed."],
  [/invoice_total|invoice_line|currency|bank_vs/, "Ask the supplier for a corrected invoice, or confirm the amount with the bank documents."],
  [/freight|insurance|dutiable/, "Enter the freight and insurance from the freight invoice and insurance certificate so the dutiable value is right."],
  [/sps_must_ship_out|sps_ship_out_margin/, "Confirm the vessel's actual departure date; if shipped late, the SPS must be cancelled or re-applied."],
  [/sps_weight|mav_quantity/, "The quantity is over the permit: apply for an additional permit or MAV allocation before lodgment."],
  [/permit_expiry|sps_validity/, "Renew the permit, or lodge before it expires."],
  [/hs_code/, "Check the AHTN code against the goods; ask for corrected documents if the certificate or permit lists a different code."],
  [/goods_description|item_description|sps_goods|invoice_vs_packing/, "Confirm with the client that all documents describe the same goods; correct the item description if needed."],
  [/incoterm/, "Confirm the Incoterm with the client; it decides whether freight and insurance are added to the dutiable value."],
  [/country_of_origin/, "Confirm the country of origin; it decides the duty rate and any FTA preference."],
  [/dangerous/, "Ask the shipper for the full dangerous goods declaration (UN number, class, packing group, emergency contact)."],
  [/signature|stamp/, "Ask for a signed and stamped copy of the document."],
];
export const fixFor = (check: string) => FIX.find(([re]) => re.test(check))?.[1] ?? "Review the documents and correct them before lodgment.";

/** A stable key for one issue, so a broker's review stays attached to it when the audit is re-run. */
export function issueKey(i: Pick<Issue, "check" | "message">): string {
  let h = 0;
  const s = `${i.check}|${i.message}`;
  for (let k = 0; k < s.length; k++) h = (Math.imul(31, h) + s.charCodeAt(k)) | 0;
  return `${i.check}:${(h >>> 0).toString(36)}`;
}

export type Light = "red" | "yellow" | "green";
/** Red: any error. Yellow: a warning not yet reviewed by a licensed broker. Green: nothing open. */
export function lightOf(issues: Pick<Issue, "severity" | "check" | "message">[], reviewed: Set<string> = new Set()): Light {
  if (issues.some((i) => i.severity === "error")) return "red";
  if (issues.some((i) => i.severity === "warning" && !reviewed.has(issueKey(i)))) return "yellow";
  return "green";
}
