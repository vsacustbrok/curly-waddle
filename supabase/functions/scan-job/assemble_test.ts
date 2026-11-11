import { assert, assertEquals } from "jsr:@std/assert@1";
import { consigneeOf, jobPatch, partsOf, primaryType, sameCompany, toDocInputs } from "./assemble.ts";
import { crossCheck } from "./crosscheck.ts";

const bl = {
  doc_type_detected: "bill_of_lading", bl_awb_number: "MEDUPB734499", vessel: "VICKY B", voyage: "0114B",
  port_of_discharge: "Manila North", container_numbers: ["MEDU 982790-2"], gross_weight: 28010, weight_unit: "KG",
  package_count: 1800, consignee: { name: "D Meter Fields Corporation", address: "Manila" },
  shipper: { name: "Pollpar Trading S.R.L." }, goods_description: "Frozen chicken middle joint wings",
};
const inv = {
  doc_type_detected: "commercial_invoice", invoice_number: "68640", currency: "USD", invoice_total: 50490,
  bl_awb_number: "WRONG-REF", consignee: { name: "D METER FIELDS CORP." }, shipper: { name: "Pollpar Trading SRL" },
  package_count: 1800, line_items: [{ description: "Frozen chicken wings", quantity: 27000, unit_price: 1.87, amount: 50490 }],
};
const cert = { doc_type_detected: "other", consignee: { name: "Somebody Else Ltd" }, container_numbers: ["XXXX0000000"] };
const combined = { id: "a", doc_type: "bill_of_lading", file_name: "68640.pdf", extracted: { parts: [bl, inv, cert], _model: "m" } };

Deno.test("partsOf handles parts, legacy rows and nothing", () => {
  assertEquals(partsOf({ parts: [bl, inv] }).length, 2);
  assertEquals(partsOf(bl).length, 1);
  assertEquals(partsOf(null), []);
});

Deno.test("primaryType prefers the transport document", () => {
  assertEquals(primaryType([cert, inv, bl]), "bill_of_lading");
  assertEquals(primaryType([cert, inv]), "commercial_invoice");
  assertEquals(primaryType([cert]), "other");
  assertEquals(primaryType([]), null);
});

Deno.test("a combined file is split into its core documents", () => {
  const inputs = toDocInputs([combined]);
  assertEquals(inputs.map((d) => d.doc_type), ["bill_of_lading", "commercial_invoice"]);
  assert(inputs[1].file_name.includes("document 2 of 3"));
  // and the cross-check runs between the documents inside the one file
  const r = crossCheck({ bl_awb_no: null, containers: [], vessel: null, voyage: null, port_of_discharge: null, client_name: null }, inputs);
  const checks = r.matches.map((m) => m.check);
  assert(checks.includes("consignee_match") && checks.includes("shipper_match") && checks.includes("package_count_match"));
  assert(r.issues.some((i) => i.check === "bl_number_match" && i.severity === "error")); // WRONG-REF on the invoice
});

Deno.test("a single-document file keeps the type its uploader chose", () => {
  const rows = [
    { id: "1", doc_type: "packing_list", file_name: "x.pdf", extracted: { parts: [{ ...inv }] } },
    { id: "2", doc_type: "other", file_name: "y.pdf", extracted: { parts: [{ ...inv }] } },
    { id: "3", doc_type: "other", file_name: "z.pdf", extracted: { parts: [cert] } },
  ];
  assertEquals(toDocInputs(rows).map((d) => d.doc_type), ["packing_list", "commercial_invoice"]);
});

Deno.test("jobPatch fills only empty fields and takes them from the transport document", () => {
  const inputs = toDocInputs([combined]);
  const empty = { bl_awb_no: null, booking_no: "", vessel: null, voyage: null, port_of_discharge: null, containers: [], eta: "2026-01-01", carrier: "x" };
  assertEquals(jobPatch(empty, inputs), {
    bl_awb_no: "MEDUPB734499", vessel: "VICKY B", voyage: "0114B", port_of_discharge: "Manila North", containers: ["MEDU9827902"],
  });
  const partly = { ...empty, voyage: "TYPED-BY-HAND", containers: ["ABCD1234567"] };
  const p = jobPatch(partly, inputs);
  assert(!("voyage" in p) && !("containers" in p) && p.vessel === "VICKY B");
  // an invoice alone never supplies the BL number
  assertEquals(jobPatch(empty, toDocInputs([{ id: "i", doc_type: "other", file_name: "i.pdf", extracted: { parts: [inv] } }])), {});
});

Deno.test("consignee and company matching", () => {
  assertEquals(consigneeOf(toDocInputs([combined])), { name: "D Meter Fields Corporation", address: "Manila" });
  assertEquals(consigneeOf([]), null);
  assert(sameCompany("D Meter Fields Corporation", "D METER FIELDS CORP."));
  assert(!sameCompany("Acme Foods Inc", "Acme Steel Inc"));
  assert(!sameCompany("Acme", "Acme Foods"));
  assert(!sameCompany("Inc.", "Corp."));
});

Deno.test("ETA and carrier are filled from the documents, arrival notice first", async () => {
  const { etaOf } = await import("./assemble.ts");
  const empty = { bl_awb_no: null, booking_no: null, vessel: null, voyage: null, port_of_discharge: null, containers: [], eta: null, carrier: null };
  const blDoc = { id: "b", doc_type: "bill_of_lading", file_name: "bl.pdf", extracted: { parts: [{ ...bl, eta_date: "2026-12-01" }] } };
  const an = { id: "n", doc_type: "other", file_name: "an.pdf", extracted: { parts: [{ doc_type_detected: "arrival_notice", eta_date: "2026-12-05", carrier_name: "MSC Mediterranean Shipping Company" }] } };
  const both = toDocInputs([blDoc, an]);
  assertEquals(etaOf(both), { date: "2026-12-05", source: "arrival_notice: an.pdf" });
  const p = jobPatch(empty, both);
  assertEquals([p.eta, p.carrier], ["2026-12-05", "MSC Mediterranean Shipping Company"]);
  // no arrival notice: ETA from the BL, carrier from the BL number prefix (MEDU = MSC)
  const q = jobPatch(empty, toDocInputs([blDoc]));
  assertEquals([q.eta, q.carrier], ["2026-12-01", "MSC"]);
  // an ETA or carrier already on the job is kept; a date that is not a real ISO date is ignored
  const kept = jobPatch({ ...empty, eta: "2026-11-30", carrier: "Typed by hand" }, both);
  assert(!("eta" in kept) && !("carrier" in kept));
  assertEquals(etaOf(toDocInputs([{ ...an, extracted: { parts: [{ doc_type_detected: "arrival_notice", eta_date: "05/12/2026" }] } }])), null);
  assertEquals(primaryType([{ doc_type_detected: "other" }, { doc_type_detected: "arrival_notice" }]), "arrival_notice");
});
