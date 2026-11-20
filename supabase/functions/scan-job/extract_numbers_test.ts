import { assertEquals } from "jsr:@std/assert@1";
import { EXTRACTION_SCHEMA, numbersOf, toNumber } from "./extract.ts";

Deno.test("numbers written as text become numbers", () => {
  assertEquals(toNumber("24,500.00 KGS"), 24500);
  assertEquals(toNumber("USD 1,234.50"), 1234.5);
  assertEquals(toNumber("1.234,56"), 1234.56);
  assertEquals(toNumber("58"), 58);
  assertEquals(toNumber("-12.5"), -12.5);
  assertEquals(toNumber(""), null);
  assertEquals(toNumber("n/a"), null);
  assertEquals(toNumber(null), null);
  assertEquals(toNumber(3), 3);
});

Deno.test("a reading's number fields are converted, text fields kept", () => {
  const p = numbersOf({ gross_weight: "24,500.00" as unknown as number, package_count: "1,200" as unknown as number, vessel: "MSC ANNA",
    line_items: [{ description: "Beef", quantity: "100" as unknown as number, unit_price: "5.5" as unknown as number, amount: "550.00" as unknown as number }] });
  assertEquals(p.gross_weight, 24500);
  assertEquals(p.package_count, 1200);
  assertEquals(p.vessel, "MSC ANNA");
  assertEquals(p.line_items?.[0], { description: "Beef", quantity: 100, unit_price: 5.5, amount: 550 });
});

Deno.test("the field list has no 'number or null' fields (the API refuses those as too large)", () => {
  assertEquals(JSON.stringify(EXTRACTION_SCHEMA).includes('"null"'), false);
});
