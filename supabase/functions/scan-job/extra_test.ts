import { assert, assertEquals } from "jsr:@std/assert@1";
import { extraChecks } from "./extra.ts";
import type { DocInput, Extracted } from "./crosscheck.ts";

const TODAY = "2026-11-11";
const party = (name: string, address = "12 Port Area, Manila", contact = "+63 2 8123 4567") => ({ name, address, contact });
const bl: Extracted = {
  shipper: party("Pollpar Trading S.R.L.", "Ruta 2 Km 18, Capiata, Paraguay", "+595 21 555 0101"), consignee: party("D Meter Fields Corporation"),
  notify_party: party("D Meter Fields Corporation"), goods_description: "Frozen chicken middle joint wings", hs_codes: ["0207.14"],
  net_weight: 27000, weight_unit: "KG", volume_cbm: 58.2, signed: "yes", stamped: "yes",
};
const inv: Extracted = {
  shipper: party("Pollpar Trading SRL", "Ruta 2 KM 18 Capiata - Paraguay", "021 555 0101"), consignee: party("D METER FIELDS CORP.", "12 Port Area Manila Philippines", "8123-4567"),
  notify_party: party("D Meter Fields Corp"), hs_codes: ["02071490"], incoterm: "CIF Manila North", country_of_origin: "Paraguay",
  net_weight: 27000, weight_unit: "KG", signed: "yes", stamped: "unclear",
  line_items: [{ description: "Frozen chicken middle joint wings", quantity: 27000, unit_price: 1.87, amount: 50490 }],
};
const pl: Extracted = {
  shipper: party("Pollpar Trading SRL", "Ruta 2 Km 18, Capiata", ""), consignee: party("D Meter Fields Corporation"),
  goods_description: "Chicken wings, frozen, middle joint", net_weight: 27000, weight_unit: "KGS", volume_cbm: 58.2, signed: "yes", stamped: "no",
};
const mk = (b: Extracted = {}, i: Extracted = {}, p: Extracted = {}, more: DocInput[] = []): DocInput[] => [
  { id: "b", file_name: "bl.pdf", doc_type: "bill_of_lading", extracted: { ...bl, ...b } },
  { id: "i", file_name: "inv.pdf", doc_type: "commercial_invoice", extracted: { ...inv, ...i } },
  { id: "p", file_name: "pl.pdf", doc_type: "packing_list", extracted: { ...pl, ...p } },
  ...more,
];
const run = (docs: DocInput[], all = docs) => extraChecks(docs, all, TODAY);
const has = (docs: DocInput[], check: string, all = docs) => run(docs, all).issues.find((x) => x.check === check);

Deno.test("a consistent set raises nothing", () => {
  const r = run(mk());
  assertEquals(r.issues, []);
  const ok = r.matches.map((m) => m.check);
  for (const c of ["notify_party_match", "invoice_vs_packing_items", "hs_code_match", "net_weight_match", "volume_match"]) assert(ok.includes(c), c);
});

Deno.test("notify party, addresses and contact numbers", () => {
  assertEquals(has(mk({}, { notify_party: party("Zenith Brokers Inc") }), "notify_party_match")?.severity, "warning");
  assert(has(mk({}, { consignee: party("D Meter Fields Corp", "Unit 5 Cebu Business Park, Cebu City") }), "consignee_address"));
  assert(has(mk({}, { shipper: party("Pollpar Trading SRL", "Ruta 2 Km 18 Capiata", "+595 981 777 222") }), "shipper_contact"));
  // different company name: left to the name check, no address noise
  assertEquals(has(mk({}, { consignee: party("Zenith Imports", "Somewhere else entirely") }), "consignee_address"), undefined);
});

Deno.test("invoice items against packing list items", () => {
  assert(has(mk({}, {}, { goods_description: "Ceramic floor tiles 60x60" }), "invoice_vs_packing_items"));
});

Deno.test("HS codes", () => {
  assert(has(mk({ hs_codes: [] }, { hs_codes: [] }), "hs_code_present"));
  assert(has(mk({}, { hs_codes: ["8539.50"] }), "hs_code_match"));
  assertEquals(has(mk({ hs_codes: [] }), "hs_code_match"), undefined); // only one document has a code
});

Deno.test("dangerous goods", () => {
  const dg = { un_number: "UN 1263", hazard_class: "3", packing_group: "II", dg_emergency_contact: "+1 703 527 3887" };
  assertEquals(run(mk(dg, dg)).issues, []);
  assert(has(mk({ ...dg, packing_group: null, dg_emergency_contact: null }, dg), "dangerous_goods_details")?.message.includes("packing group, emergency contact"));
  assertEquals(has(mk(dg, { ...dg, un_number: "UN1993" }), "dangerous_goods_un_match")?.severity, "error");
  assert(has(mk({}, dg), "dangerous_goods_details")?.message.includes("but not on bl.pdf"));
});

Deno.test("net weight, volume and Incoterms", () => {
  assertEquals(has(mk({}, {}, { net_weight: 26000 }), "net_weight_match")?.severity, "error");
  assertEquals(has(mk({}, {}, { net_weight: 59524.8, weight_unit: "LBS" }), "net_weight_match"), undefined); // 27,000 kg in pounds
  assert(has(mk({}, {}, { volume_cbm: 61 }), "volume_match"));
  assert(has(mk({}, { incoterm: null }), "incoterm_present"));
  assert(has(mk({}, {}, { incoterm: "FOB" }), "incoterm_match"));
  assertEquals(has(mk({}, { incoterm: "C&F Manila" }, { incoterm: "CFR" }), "incoterm_match"), undefined);
});

Deno.test("country of origin across all documents, including certificates", () => {
  const cert = (c: string): DocInput => ({ id: "c", file_name: "co.pdf", doc_type: "other", extracted: { country_of_origin: c } });
  const docs = mk();
  assertEquals(has(docs, "country_of_origin_match", [...docs, cert("REPUBLIC OF PARAGUAY")]), undefined);
  assert(has(docs, "country_of_origin_match", [...docs, cert("Brazil")]));
});

Deno.test("SPS validity, signatures and stamps", () => {
  const sps = (x: Extracted): DocInput => ({ id: "s", file_name: "sps.pdf", doc_type: "sps_import_clearance", extracted: { signed: "yes", stamped: "yes", ...x } });
  assert(has(mk({}, {}, {}, [sps({ sps_valid_until: "2026-11-10" })]), "sps_validity"));
  assertEquals(has(mk({}, {}, {}, [sps({ sps_valid_until: "2026-11-11" })]), "sps_validity"), undefined);
  assert(has(mk({ signed: "no" }), "signature")?.message.includes("bl.pdf"));
  assertEquals(has(mk({ signed: "unclear" }), "signature"), undefined);
  assert(has(mk({ stamped: "no" }), "stamp"));
  assertEquals(has(mk(), "stamp"), undefined); // the packing list has no stamp, which is normal
  assert(has(mk({}, {}, {}, [sps({ stamped: "no" })]), "stamp")?.message.includes("sps.pdf"));
});
