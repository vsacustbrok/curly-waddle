import { assert, assertEquals } from "jsr:@std/assert@1";
import { auditChecks, fixFor, issueKey, lightOf, stageOf } from "./audit.ts";
import { weakReading, documentType } from "./extract.ts";
import type { DocInput, Extracted } from "./crosscheck.ts";

const doc = (doc_type: string, extracted: Extracted, file_name = `${doc_type}.pdf`): DocInput => ({ id: doc_type, file_name, doc_type, extracted });
const bl = (x: Extracted = {}) => doc("bill_of_lading", { bl_awb_number: "MAEU9827361", goods_description: "steel bolts", ...x });
const ci = (x: Extracted = {}) => doc("commercial_invoice", { invoice_total: 1000, currency: "USD", incoterm: "CIF", ...x });
const pl = (x: Extracted = {}) => doc("packing_list", { ...x });
const TODAY = "2026-11-18";
const checks = (r: ReturnType<typeof auditChecks>) => r.issues.map((i) => `${i.severity}:${i.check}`).sort();

Deno.test("complete, consistent documents give no issues and a green light", () => {
  const r = auditChecks({}, [bl(), ci(), pl()], TODAY);
  assertEquals(r.issues, []);
  assertEquals(lightOf(r.issues), "green");
});

Deno.test("stage 1: a missing packing list is red", () => {
  const r = auditChecks({}, [bl(), ci()], TODAY);
  assertEquals(checks(r), ["error:completeness"]);
  assert(r.issues[0].message.includes("Packing list"));
  assertEquals(lightOf(r.issues), "red");
});

Deno.test("stage 1: an air shipment needs an air waybill, and extra required documents count", () => {
  const awb = doc("airway_bill", { bl_awb_number: "618-12345675" });
  const r = auditChecks({ required_docs: ["certificate_of_origin"] }, [awb, ci(), pl()], TODAY);
  assertEquals(checks(r), ["error:completeness"]);
  assert(r.issues[0].message.includes("Certificate of origin"));
});

Deno.test("stage 1: frozen goods without an SPS are red", () => {
  const r = auditChecks({ item_description: "Frozen chicken cuts" }, [bl(), ci(), pl()], TODAY);
  assertEquals(checks(r), ["error:completeness"]);
  assert(r.issues[0].message.includes("SPS"));
  const ok = auditChecks({ item_description: "Frozen chicken cuts" }, [bl(), ci(), pl(), doc("sps_import_clearance", { sps_valid_until: "2026-12-31" })], TODAY);
  assertEquals(checks(ok), []);
});

Deno.test("stage 2: different seal numbers and TINs are red", () => {
  const r = auditChecks({}, [
    bl({ seal_numbers: ["ML-123456"], consignee: { name: "A", tin: "123-456-789-000" } }),
    doc("container_list", { seal_numbers: ["ML-123457"] }),
    ci({ consignee: { name: "A", tin: "987-654-321-000" } }), pl(),
  ], TODAY);
  assertEquals(checks(r), ["error:consignee_tin_match", "error:seal_numbers_match"]);
});

Deno.test("stage 2: FOB without freight asks for the freight amount; entered freight is compared", () => {
  const r = auditChecks({}, [bl(), ci({ incoterm: "FOB Shanghai" }), pl()], TODAY);
  assertEquals(checks(r), ["warning:dutiable_value"]);
  const r2 = auditChecks({ freight_amount: 1200, charges_currency: "USD" }, [bl({ freight_amount: 1500 }), ci({ incoterm: "FOB" }), pl()], TODAY);
  assertEquals(checks(r2), ["warning:freight_amount_match"]);
});

Deno.test("stage 2: a letter of credit for a different amount is a warning", () => {
  const r = auditChecks({}, [bl(), ci(), pl(), doc("bank_document", { invoice_total: 1200, currency: "USD" })], TODAY);
  assertEquals(checks(r), ["warning:bank_vs_invoice"]);
});

Deno.test("stage 3: expired permit is red, expiring within 5 days is yellow", () => {
  const exp = auditChecks({}, [bl(), ci(), pl(), doc("fda_permit", { sps_valid_until: "2026-11-10", document_number: "FDA-1" })], TODAY);
  assertEquals(checks(exp), ["error:permit_expiry"]);
  const soon = auditChecks({}, [bl(), ci(), pl(), doc("importer_accreditation", { sps_valid_until: "2026-11-21" })], TODAY);
  assertEquals(checks(soon), ["warning:permit_expiry"]);
  assert(soon.issues[0].message.includes("in 3 days"));
});

Deno.test("stage 3: shipped within 2 days of the SPS must-ship-out date is a warning", () => {
  const r = auditChecks({}, [bl({ shipped_on_board_date: "2026-11-15" }), ci(), pl(),
    doc("sps_import_clearance", { sps_must_ship_out_date: "2026-11-17", sps_valid_until: "2027-01-31" })], TODAY);
  assertEquals(checks(r), ["warning:sps_ship_out_margin"]);
});

Deno.test("stage 3: net weight above the MAV allocation is red", () => {
  const r = auditChecks({}, [bl(), ci({ net_weight: 25000, weight_unit: "KG" }), pl(),
    doc("mav_certificate", { sps_permitted_weight: 24, sps_permitted_weight_unit: "MT", sps_valid_until: "2027-06-30" })], TODAY);
  assertEquals(checks(r), ["error:mav_quantity"]);
  assert(r.issues[0].message.includes("1,000 kg"));
});

Deno.test("stage 4: certificate of origin with other HS codes is red; a permit with other codes is yellow", () => {
  const inv = ci({ line_items: [{ description: "Frozen chicken cuts", hs_code: "0207.14.91" }] });
  const co = auditChecks({}, [bl(), inv, pl(), doc("certificate_of_origin", { hs_codes: ["0304.89"] })], TODAY);
  assertEquals(checks(co), ["error:hs_code_permits"]);
  const permit = auditChecks({}, [bl(), inv, pl(), doc("agency_permit", { hs_codes: ["8708.99"], sps_valid_until: "2027-01-01" })], TODAY);
  assertEquals(checks(permit), ["warning:hs_code_permits"]);
  const ok = auditChecks({}, [bl(), inv, pl(), doc("certificate_of_origin", { hs_codes: ["020714"] })], TODAY);
  assertEquals(checks(ok), []);
});

Deno.test("a reviewed warning turns yellow into green; an error stays red", () => {
  const warn = { severity: "warning" as const, check: "permit_expiry", message: "expires soon" };
  assertEquals(lightOf([warn]), "yellow");
  assertEquals(lightOf([warn], new Set([issueKey(warn)])), "green");
  const err = { severity: "error" as const, check: "completeness", message: "missing" };
  assertEquals(lightOf([err, warn], new Set([issueKey(err), issueKey(warn)])), "red");
});

Deno.test("stages and fix suggestions", () => {
  assertEquals(stageOf("completeness"), 0);
  assertEquals(stageOf("gross_weight_match"), 1);
  assertEquals(stageOf("sps_must_ship_out"), 2);
  assertEquals(stageOf("hs_code_match"), 3);
  assert(fixFor("gross_weight_match").includes("packing list"));
  assertEquals(issueKey({ check: "a", message: "b" }), issueKey({ check: "a", message: "b" }));
});

Deno.test("a weak reading is re-read with the top model", () => {
  assertEquals(weakReading([]), true);
  assertEquals(weakReading([{ doc_type_detected: "bill_of_lading" }]), true);
  assertEquals(weakReading([{ doc_type_detected: "commercial_invoice", invoice_total: null }]), true);
  assertEquals(weakReading([{ doc_type_detected: "packing_list", notes: "Bottom of page 2 is illegible." }]), true);
  assertEquals(weakReading([{ doc_type_detected: "bill_of_lading", bl_awb_number: "X1" }, { doc_type_detected: "commercial_invoice", invoice_total: 5 }]), false);
});

Deno.test("new document types are recognised", () => {
  assertEquals(documentType("Certificate of Origin Form E"), "certificate_of_origin");
  assertEquals(documentType("Letter of Credit"), "bank_document");
  assertEquals(documentType("Phytosanitary certificate"), "phytosanitary_certificate");
  assertEquals(documentType("BPS ICC"), "agency_permit");
  assertEquals(documentType("container_list"), "container_list");
  assertEquals(documentType("MAV certificate"), "mav_certificate");
});
