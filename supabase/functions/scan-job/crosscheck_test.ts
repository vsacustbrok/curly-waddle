import { assert, assertEquals } from "jsr:@std/assert@1";
import { crossCheck, isValidContainer, nameSimilarity, sameRef, toKg, type DocInput, type JobInput } from "./crosscheck.ts";

const job: JobInput = {
  bl_awb_no: "MAEU123456789",
  containers: ["CSQU3054383"],
  vessel: "MAERSK SELETAR",
  voyage: "245N",
  port_of_discharge: "MANILA",
  client_name: "Acme Trading Phils. Inc.",
};

function docs(over: { bl?: object; inv?: object; pl?: object } = {}): DocInput[] {
  return [
    {
      id: "1", file_name: "bl.pdf", doc_type: "bill_of_lading",
      extracted: {
        bl_awb_number: "123456789",
        shipper: { name: "Shenzhen Bright Lighting Co., Ltd." },
        consignee: { name: "ACME TRADING PHILIPPINES INC" },
        container_numbers: ["CSQU 305438 3"],
        gross_weight: 12500, weight_unit: "KGS",
        package_count: 500, package_type: "CARTONS",
        goods_description: "LED LIGHT BULBS AND PANEL LIGHTS",
        vessel: "MAERSK SELETAR", voyage: "245N",
        ...over.bl,
      },
    },
    {
      id: "2", file_name: "inv.pdf", doc_type: "commercial_invoice",
      extracted: {
        shipper: { name: "SHENZHEN BRIGHT LIGHTING CO LTD" },
        consignee: { name: "Acme Trading Phils Inc" },
        currency: "USD", invoice_total: 25000,
        package_count: 500,
        line_items: [
          { description: "LED light bulb 9W", quantity: 10000, unit_price: 1.5, amount: 15000 },
          { description: "LED panel light 600x600", quantity: 1000, unit_price: 10, amount: 10000 },
        ],
        ...over.inv,
      },
    },
    {
      id: "3", file_name: "pl.pdf", doc_type: "packing_list",
      extracted: {
        shipper: { name: "Shenzhen Bright Lighting" },
        consignee: { name: "ACME Trading" },
        container_numbers: ["CSQU3054383"],
        gross_weight: 27557.9, weight_unit: "LBS", // = 12500 kg
        net_weight: 11000, package_count: 500,
        line_items: [{ description: "LED bulbs" }, { description: "LED panel" }],
        ...over.pl,
      },
    },
  ];
}

Deno.test("helpers", () => {
  assert(isValidContainer("CSQU3054383"));
  assert(!isValidContainer("CSQU3054384"));
  assert(sameRef("MAEU123456789", "123456789"));
  assert(sameRef("maeu-1234 56789", "MAEU123456789"));
  assert(!sameRef("MAEU123456789", "MAEU123456780"));
  assert(nameSimilarity("Acme Trading Phils. Inc.", "ACME TRADING PHILIPPINES INC") >= 0.6);
  assert(nameSimilarity("Acme Trading", "Zenith Imports") < 0.6);
  assertEquals(Math.round(toKg(27557.9, "LBS")!), 12500);
});

Deno.test("a consistent document set has no errors", () => {
  const { issues, matches } = crossCheck(job, docs());
  assertEquals(issues.filter((i) => i.severity === "error"), []);
  const checks = new Set(matches.map((m) => m.check));
  for (const c of ["shipper_match", "consignee_match", "bl_number_match", "containers_match", "gross_weight_match", "package_count_match", "invoice_total", "goods_description_match", "consignee_vs_client"]) {
    assert(checks.has(c), `expected match for ${c}`);
  }
});

Deno.test("each mismatch is caught", () => {
  const cases: Array<[string, Parameters<typeof docs>[0]]> = [
    ["shipper_match", { inv: { shipper: { name: "Guangzhou Ocean Textiles Ltd" } } }],
    ["consignee_match", { pl: { consignee: { name: "Zenith Imports Corp" } } }],
    ["bl_number_match", { bl: { bl_awb_number: "MAEU999999999" } }],
    ["containers_match", { pl: { container_numbers: ["CSQU3054383", "MSCU1234565"] } }],
    ["gross_weight_match", { pl: { gross_weight: 13000, weight_unit: "KG" } }],
    ["package_count_match", { inv: { package_count: 480 } }],
    ["invoice_total", { inv: { invoice_total: 26000 } }],
  ];
  for (const [check, over] of cases) {
    const { issues } = crossCheck(job, docs(over));
    assert(issues.some((i) => i.check === check && i.severity === "error"), `${check} not flagged`);
  }
});

Deno.test("warnings: description, check digit, missing docs, line math", () => {
  let r = crossCheck(job, docs({ bl: { goods_description: "FROZEN PORK BELLY" } }));
  assert(r.issues.some((i) => i.check === "goods_description_match"));
  r = crossCheck({ ...job, containers: [] }, docs({ bl: { container_numbers: ["CSQU3054384"] }, pl: { container_numbers: ["CSQU3054384"] } }));
  assert(r.issues.some((i) => i.check === "container_check_digit"));
  r = crossCheck(job, docs().slice(0, 1));
  assertEquals(r.issues.filter((i) => i.check === "documents_present").length, 2);
  r = crossCheck(job, docs({ inv: { line_items: [{ description: "x", quantity: 2, unit_price: 5, amount: 11 }], invoice_total: 11 } }));
  assert(r.issues.some((i) => i.check === "invoice_line_math"));
});
