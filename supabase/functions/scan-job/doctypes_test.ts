import { assertEquals } from "jsr:@std/assert@1";
import { crossCheck, type DocInput } from "./crosscheck.ts";
import { jobPatch, primaryType } from "./assemble.ts";

const job = { bl_awb_no: null, containers: null, vessel: null, voyage: null, port_of_discharge: null, client_name: null };
const doc = (doc_type: string, goods: string): DocInput =>
  ({ doc_type, file_name: `${doc_type}.pdf`, extracted: { doc_type_detected: doc_type, goods_description: goods } } as DocInput);

Deno.test("a telex-released BL and a sea waybill count as the transport document", () => {
  for (const t of ["telex_release", "seaway_bill"]) {
    const r = crossCheck(job, [doc(t, "FROZEN PORK SHOULDER"), doc("commercial_invoice", "FROZEN PORK SHOULDER BONELESS")]);
    assertEquals(r.issues.some((i) => i.check === "documents_present" && /transport|bill of lading/i.test(i.message)), false, t);
    assertEquals(r.matches.some((m) => m.check === "goods_description_match"), true, t);
  }
});

Deno.test("sales contract and purchase order goods are compared with the BL", () => {
  const r = crossCheck(job, [doc("bill_of_lading", "FROZEN PORK SHOULDER"), doc("purchase_order", "CHICKEN WINGS"), doc("sales_contract", "PORK SHOULDER FROZEN")]);
  assertEquals(r.issues.filter((i) => i.check === "goods_description_match").length, 1);
  assertEquals(r.matches.filter((m) => m.check === "goods_description_match").length, 1);
});

Deno.test("the item description in the project details is checked against each document", () => {
  const r = crossCheck({ ...job, item_description: "FROZEN PORK SHOULDER" }, [doc("seaway_bill", "FROZEN PORK SHOULDER 4D"), doc("commercial_invoice", "SPEAKER AMPLIFIER")]);
  const issues = r.issues.filter((i) => i.check === "item_description_match");
  assertEquals(issues.length, 1);
  assertEquals(issues[0].message.includes("commercial_invoice.pdf"), true);
});

Deno.test("item description and BL release are filled from a telex release", () => {
  const p = jobPatch({ ...job, booking_no: null, eta: null, carrier: null, item_description: null, bl_release_type: null }, [doc("telex_release", "FROZEN SQUID RINGS")]);
  assertEquals(p.item_description, "FROZEN SQUID RINGS");
  assertEquals(p.bl_release_type, "telex");
});

Deno.test("a combined file is filed under its transport document", () => {
  assertEquals(primaryType([{ doc_type_detected: "purchase_order" }, { doc_type_detected: "seaway_bill" }]), "seaway_bill");
});

import { documentType } from "./extract.ts";
Deno.test("the reader's document type is always one of the known names", () => {
  assertEquals(documentType("seaway_bill"), "seaway_bill");
  assertEquals(documentType("Sea Waybill"), "seaway_bill");
  assertEquals(documentType("TELEX RELEASED BL"), "telex_release");
  assertEquals(documentType("Purchase Order"), "purchase_order");
  assertEquals(documentType("certificate of origin"), "other");
  assertEquals(documentType(null), "other");
});
