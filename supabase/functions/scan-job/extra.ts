// Further document checks from the brokerage's verification checklist: notify party,
// addresses and contact numbers, invoice vs packing list items, HS codes, dangerous goods,
// net weight and volume, Incoterms, country of origin, SPS validity, signatures and stamps.
// Deterministic, like crosscheck.ts. Most of these are warnings: they point a person at
// something to look at rather than declare the documents wrong.
import { descTokens, nameSimilarity, toKg, type DocInput, type Extracted, type Issue, type Match, type Party } from "./crosscheck.ts";

const TRANSPORT = ["bill_of_lading", "airway_bill"];
const SHIPPING = [...TRANSPORT, "commercial_invoice", "packing_list"];
const SPS = "sps_import_clearance";
const NAME_MATCH = 0.6;

const label = (d: DocInput) => `${d.doc_type}: ${d.file_name}`;
const digits = (v: string | null | undefined) => (v ?? "").replace(/\D/g, "");
const words = (v: string | null | undefined) =>
  new Set((v ?? "").toUpperCase().replace(/[^A-Z0-9 ]+/g, " ").split(/\s+/).filter((t) => t.length > 1));
function overlap(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 1;
  let n = 0;
  for (const t of a) if (b.has(t)) n++;
  return n / Math.min(a.size, b.size);
}
/** Phone numbers match when one ends with the other (country and area codes are often left off). */
function samePhone(a: string, b: string): boolean {
  const x = digits(a), y = digits(b);
  if (x.length < 7 || y.length < 7) return true; // too short to judge
  return x.endsWith(y.slice(-7)) || y.endsWith(x.slice(-7));
}
const hs6 = (codes: string[] | null | undefined) =>
  new Set((codes ?? []).map((c) => digits(c).slice(0, 6)).filter((c) => c.length === 6));
const country = (v: string | null | undefined) => (v ?? "").toUpperCase().replace(/[^A-Z ]+/g, " ").replace(/\s+/g, " ").trim();

/**
 * @param docs  the shipping documents and SPS clearances on the job
 * @param all   every document read from the job's files, including certificates and other papers
 * @param today YYYY-MM-DD, passed in so the result is repeatable in tests
 */
export function extraChecks(docs: DocInput[], all: DocInput[], today: string): { issues: Issue[]; matches: Match[] } {
  const issues: Issue[] = [];
  const matches: Match[] = [];
  const warn = (check: string, message: string, values: Issue["values"] = []) => issues.push({ severity: "warning", check, message, values });
  const shipping = docs.filter((d) => d.extracted && SHIPPING.includes(d.doc_type));
  const e = (d: DocInput) => d.extracted as Extracted;
  const transport = shipping.filter((d) => TRANSPORT.includes(d.doc_type));
  const invoices = shipping.filter((d) => d.doc_type === "commercial_invoice");
  const packing = shipping.filter((d) => d.doc_type === "packing_list");

  // --- notify party ---
  {
    const vals = shipping.map((d) => ({ source: label(d), value: e(d).notify_party?.name ?? null })).filter((v) => v.value);
    if (vals.length >= 2) {
      if (vals.slice(1).some((v) => nameSimilarity(vals[0].value, v.value) < NAME_MATCH)) {
        warn("notify_party_match", "Notify party differs between documents.", vals);
      } else matches.push({ check: "notify_party_match", value: vals[0].value, sources: vals.map((v) => v.source) });
    }
  }

  // --- addresses and contact numbers, where the same party is named ---
  for (const role of ["shipper", "consignee", "notify_party"] as const) {
    const title = role === "notify_party" ? "Notify party" : role === "shipper" ? "Shipper" : "Consignee";
    const parties = shipping.map((d) => ({ d, p: e(d)[role] as Party | null | undefined })).filter((x) => x.p?.name);
    if (parties.length < 2) continue;
    const base = parties[0];
    const same = parties.slice(1).filter((x) => nameSimilarity(base.p!.name, x.p!.name) >= NAME_MATCH);
    const addrOff = same.filter((x) => base.p!.address && x.p!.address && overlap(words(base.p!.address), words(x.p!.address)) < 0.3);
    if (addrOff.length) {
      warn(`${role}_address`, `${title} address differs between documents.`,
        [base, ...addrOff].map((x) => ({ source: label(x.d), value: x.p!.address })));
    }
    const phoneOff = same.filter((x) => base.p!.contact && x.p!.contact && !samePhone(base.p!.contact, x.p!.contact));
    if (phoneOff.length) {
      warn(`${role}_contact`, `${title} contact number differs between documents.`,
        [base, ...phoneOff].map((x) => ({ source: label(x.d), value: x.p!.contact })));
    }
  }

  // --- invoice items against packing list items ---
  const describe = (d: DocInput) =>
    [e(d).goods_description, ...(e(d).line_items ?? []).map((l) => l.description)].filter(Boolean).join(" ");
  for (const inv of invoices) {
    for (const pl of packing) {
      const a = descTokens(describe(inv)), b = descTokens(describe(pl));
      if (!a.size || !b.size) continue;
      if (overlap(a, b) < 0.2) {
        warn("invoice_vs_packing_items", `The items on ${inv.file_name} share few words with the items on ${pl.file_name}. Confirm they list the same goods.`,
          [{ source: label(inv), value: describe(inv).slice(0, 300) }, { source: label(pl), value: describe(pl).slice(0, 300) }]);
      } else matches.push({ check: "invoice_vs_packing_items", value: [...a].filter((t) => b.has(t)).slice(0, 8).join(" "), sources: [label(inv), label(pl)] });
    }
  }

  // --- HS codes ---
  {
    const withCodes = shipping.map((d) => ({ d, set: hs6(e(d).hs_codes) })).filter((x) => x.set.size);
    if (shipping.length && withCodes.length === 0) {
      warn("hs_code_present", "No HS code was found on any shipping document. It is needed to work out duties.");
    } else if (withCodes.length >= 2) {
      const base = withCodes[0];
      const off = withCodes.slice(1).filter((x) => ![...x.set].some((c) => base.set.has(c)));
      const values = withCodes.map((x) => ({ source: label(x.d), value: [...x.set].sort().join(", ") }));
      if (off.length) warn("hs_code_match", "HS codes differ between documents (compared on the first six digits).", values);
      else matches.push({ check: "hs_code_match", value: [...base.set].sort().join(", "), sources: withCodes.map((x) => label(x.d)) });
    }
  }

  // --- dangerous goods ---
  {
    const dg = shipping.filter((d) => e(d).un_number || e(d).hazard_class);
    for (const d of dg) {
      const x = e(d);
      const missing = [
        !x.un_number && "UN number", !x.hazard_class && "hazard class", !x.packing_group && "packing group",
        !x.dg_emergency_contact && "emergency contact number",
      ].filter(Boolean);
      if (missing.length) warn("dangerous_goods_details", `${d.file_name} declares dangerous goods but does not show: ${missing.join(", ")}.`);
    }
    const uns = dg.map((d) => ({ source: label(d), value: digits(e(d).un_number) })).filter((v) => v.value);
    if (uns.length >= 2) {
      if (new Set(uns.map((u) => u.value)).size > 1) {
        issues.push({ severity: "error", check: "dangerous_goods_un_match", message: "UN numbers differ between documents.", values: uns });
      } else matches.push({ check: "dangerous_goods_un_match", value: `UN${uns[0].value}`, sources: uns.map((u) => u.source) });
    }
    const silent = shipping.filter((d) => !dg.includes(d) && TRANSPORT.includes(d.doc_type));
    if (dg.length && silent.length) {
      warn("dangerous_goods_details", `Dangerous goods are declared on ${dg.map((d) => d.file_name).join(", ")} but not on ${silent.map((d) => d.file_name).join(", ")}.`);
    }
  }

  // --- net weight and volume ---
  {
    const nets = shipping.map((d) => ({ source: label(d), raw: e(d).net_weight, unit: e(d).weight_unit, kg: toKg(e(d).net_weight, e(d).weight_unit) }))
      .filter((v) => v.kg != null && v.kg > 0);
    if (nets.length >= 2) {
      const base = nets[0].kg!;
      const values = nets.map((v) => ({ source: v.source, value: `${v.raw} ${v.unit ?? "kg"}` }));
      if (nets.slice(1).some((v) => Math.abs(v.kg! - base) / base > 0.005)) {
        issues.push({ severity: "error", check: "net_weight_match", message: "Net weight differs by more than 0.5% between documents.", values });
      } else matches.push({ check: "net_weight_match", value: `${base.toFixed(2)} kg`, sources: nets.map((v) => v.source) });
    }
    const vols = shipping.map((d) => ({ source: label(d), value: e(d).volume_cbm })).filter((v) => v.value != null && v.value > 0);
    if (vols.length >= 2) {
      const base = vols[0].value!;
      if (vols.slice(1).some((v) => Math.abs(v.value! - base) / base > 0.01)) {
        warn("volume_match", "Volume (CBM) differs by more than 1% between documents.", vols);
      } else matches.push({ check: "volume_match", value: `${base} CBM`, sources: vols.map((v) => v.source) });
    }
  }

  // --- Incoterms ---
  {
    const term = (d: DocInput) => (e(d).incoterm ?? "").toUpperCase().match(/\b(EXW|FCA|FAS|FOB|CFR|CIF|CPT|CIP|DAP|DPU|DAT|DDP|C&F|CNF)\b/)?.[1]?.replace(/C&F|CNF/, "CFR") ?? null;
    for (const inv of invoices) if (!term(inv)) warn("incoterm_present", `No Incoterm (FOB, CIF, ...) was found on ${inv.file_name}.`);
    const terms = shipping.map((d) => ({ source: label(d), value: term(d) })).filter((v) => v.value);
    if (new Set(terms.map((t) => t.value)).size > 1) warn("incoterm_match", "Incoterms differ between documents.", terms);
    else if (terms.length >= 2) matches.push({ check: "incoterm_match", value: terms[0].value, sources: terms.map((t) => t.source) });
  }

  // --- country of origin, across every document including certificates ---
  {
    const vals = all.filter((d) => d.extracted).map((d) => ({ source: label(d), value: country(e(d).country_of_origin) })).filter((v) => v.value);
    if (vals.length >= 2) {
      const base = vals[0].value;
      const off = vals.slice(1).filter((v) => !(v.value.includes(base) || base.includes(v.value)));
      if (off.length) warn("country_of_origin_match", "Country of origin differs between documents.", vals);
      else matches.push({ check: "country_of_origin_match", value: base, sources: vals.map((v) => v.source) });
    }
  }

  // --- SPS validity ---
  for (const d of docs.filter((x) => x.extracted && x.doc_type === SPS)) {
    const until = e(d).sps_valid_until;
    if (until && /^\d{4}-\d{2}-\d{2}$/.test(until) && until < today) {
      warn("sps_validity", `The SPS on ${d.file_name} was valid until ${until}, which has passed.`, [{ source: label(d), value: until }]);
    }
  }

  // --- signatures and stamps ---
  for (const d of docs.filter((x) => x.extracted && (SHIPPING.includes(x.doc_type) || x.doc_type === SPS))) {
    if (e(d).signed === "no") warn("signature", `No signature was seen on ${d.file_name} (${d.doc_type.replace(/_/g, " ")}).`);
    if ((TRANSPORT.includes(d.doc_type) || d.doc_type === SPS) && e(d).stamped === "no") {
      warn("stamp", `No official stamp or seal was seen on ${d.file_name} (${d.doc_type.replace(/_/g, " ")}).`);
    }
  }

  return { issues, matches };
}
