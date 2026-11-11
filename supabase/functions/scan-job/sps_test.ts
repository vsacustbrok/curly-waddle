import { assert, assertEquals } from "jsr:@std/assert@1";
import { spsChecks } from "./sps.ts";
import { crossCheck, type DocInput, type Extracted } from "./crosscheck.ts";
import { primaryType, toDocInputs } from "./assemble.ts";

const blBase: Extracted = {
  bl_awb_number: "MEDUPB734499", consignee: { name: "D Meter Fields Corporation" }, shipper: { name: "Pollpar Trading S.R.L." },
  goods_description: "1800 boxes frozen chicken middle joint wings", gross_weight: 28010, net_weight: 27000, weight_unit: "KG",
  shipped_on_board_date: "2026-10-30",
};
const spsBase: Extracted = {
  document_number: "SPS-2026-001234", consignee: { name: "D METER FIELDS CORP." }, shipper: { name: "Pollpar Trading SRL" },
  goods_description: "Frozen chicken wings", issue_date: "2026-09-15", sps_must_ship_out_date: "2026-11-14",
  sps_permitted_weight: 27000, sps_permitted_weight_unit: "kg",
};
const docs = (bl: Extracted = {}, sps: Extracted = {}, extra: DocInput[] = []): DocInput[] => [
  { id: "b", file_name: "bl.pdf", doc_type: "bill_of_lading", extracted: { ...blBase, ...bl } },
  { id: "s", file_name: "sps.pdf", doc_type: "sps_import_clearance", extracted: { ...spsBase, ...sps } },
  ...extra,
];
const find = (r: ReturnType<typeof spsChecks>, check: string) => r.issues.find((i) => i.check === check);

Deno.test("a compliant SPS passes every check", () => {
  const r = spsChecks(docs());
  assertEquals(r.issues, []);
  assertEquals(r.matches.map((m) => m.check).sort(), ["sps_consignee_match", "sps_goods_match", "sps_must_ship_out", "sps_shipper_match", "sps_weight"]);
});

Deno.test("no SPS on the job means no SPS findings", () => {
  assertEquals(spsChecks(docs().slice(0, 1)), { issues: [], matches: [] });
});

Deno.test("must ship out date", () => {
  assertEquals(find(spsChecks(docs({ shipped_on_board_date: "2026-11-14" })), "sps_must_ship_out"), undefined); // last day is allowed
  assertEquals(find(spsChecks(docs({ shipped_on_board_date: "2026-11-15" })), "sps_must_ship_out")?.severity, "error");
  const early = find(spsChecks(docs({ shipped_on_board_date: "2026-09-14" })), "sps_must_ship_out");
  assert(early?.severity === "error" && early.message.includes("before the SPS was issued"));
  assertEquals(find(spsChecks(docs({ shipped_on_board_date: null })), "sps_must_ship_out")?.severity, "warning");
  assertEquals(find(spsChecks(docs({}, { sps_must_ship_out_date: null })), "sps_must_ship_out")?.severity, "warning");
  // a date that is not a real ISO date is treated as unread, never compared as text
  assertEquals(find(spsChecks(docs({ shipped_on_board_date: "30/10/2026" })), "sps_must_ship_out")?.severity, "warning");
});

Deno.test("weight may differ from the SPS quantity by at most 3%", () => {
  // 3% of 27,000 kg is 810 kg
  assertEquals(find(spsChecks(docs({ net_weight: 27500 })), "sps_weight"), undefined); // 1.85% over
  assertEquals(find(spsChecks(docs({ net_weight: 27810 })), "sps_weight"), undefined); // exactly 3% over
  assertEquals(find(spsChecks(docs({ net_weight: 26190 })), "sps_weight"), undefined); // exactly 3% under
  const over = find(spsChecks(docs({ net_weight: 27811 })), "sps_weight");
  assert(over?.severity === "error" && over.message.includes("cancelled or re-applied") && over.message.includes("811 kg"));
  const under = find(spsChecks(docs({ net_weight: 26189 })), "sps_weight");
  assert(under?.severity === "warning" && under.message.includes("below"));
  const ok = spsChecks(docs({ net_weight: 27500 })).matches.find((m) => m.check === "sps_weight");
  assert(String(ok?.value).includes("1.85% over"));
  // units are converted
  assertEquals(find(spsChecks(docs({}, { sps_permitted_weight: 27, sps_permitted_weight_unit: "MT" })), "sps_weight"), undefined);
  // no net weight anywhere: gross (28,010 kg, 3.74% over) is a warning to confirm, not an error
  assertEquals(find(spsChecks(docs({ net_weight: null })), "sps_weight")?.severity, "warning");
  // net weight taken from the packing list when the BL has none
  const pl: DocInput = { id: "p", file_name: "pl.pdf", doc_type: "packing_list", extracted: { net_weight: 27000, weight_unit: "KG" } };
  assertEquals(find(spsChecks(docs({ net_weight: null }, {}, [pl])), "sps_weight"), undefined);
  assertEquals(find(spsChecks(docs({}, { sps_permitted_weight: null })), "sps_weight")?.severity, "warning");
});

Deno.test("two SPS clearances on one job add up; a duplicate upload does not", () => {
  const second: DocInput = { id: "s2", file_name: "sps2.pdf", doc_type: "sps_import_clearance", extracted: { ...spsBase, document_number: "SPS-2026-009999", sps_permitted_weight: 13000 } };
  assertEquals(find(spsChecks(docs({ net_weight: 27000 }, { sps_permitted_weight: 14000 }, [second])), "sps_weight"), undefined);
  const dup: DocInput = { id: "s3", file_name: "copy.pdf", doc_type: "sps_import_clearance", extracted: { ...spsBase } };
  assertEquals(find(spsChecks(docs({ net_weight: 40000 }, {}, [dup])), "sps_weight")?.severity, "error");
});

Deno.test("parties and goods", () => {
  assertEquals(find(spsChecks(docs({}, { consignee: { name: "Zenith Imports Inc" } })), "sps_consignee_match")?.severity, "error");
  assertEquals(find(spsChecks(docs({}, { shipper: { name: "Willard Meats International" } })), "sps_shipper_match")?.severity, "warning");
  assertEquals(find(spsChecks(docs({}, { goods_description: "Fresh onions" })), "sps_goods_match")?.severity, "warning");
});

Deno.test("SPS without a bill of lading is reported, and SPS stays out of the shipping-document checks", () => {
  assertEquals(spsChecks(docs().slice(1)).issues[0].check, "sps_vs_bl");
  const r = crossCheck({ bl_awb_no: null, containers: [], vessel: null, voyage: null, port_of_discharge: null, client_name: null },
    docs({}, { consignee: { name: "Zenith Imports Inc" }, gross_weight: 1 }));
  assert(!r.issues.some((i) => i.check === "consignee_match" || i.check === "gross_weight_match"));
});

Deno.test("an SPS inside a combined file is picked up and filed", () => {
  const row = { id: "f", doc_type: "other", file_name: "all.pdf", extracted: { parts: [{ doc_type_detected: "other" }, { doc_type_detected: "sps_import_clearance", ...spsBase }] } };
  assertEquals(toDocInputs([row]).map((d) => d.doc_type), ["sps_import_clearance"]);
  assertEquals(primaryType([{ doc_type_detected: "other" }, { doc_type_detected: "sps_import_clearance" }]), "sps_import_clearance");
  assertEquals(primaryType([{ doc_type_detected: "sps_import_clearance" }, { doc_type_detected: "bill_of_lading" }]), "bill_of_lading");
});
