import { assertEquals } from "jsr:@std/assert@1";
import { cleanLine, isExpired, quoteTotals } from "../src/lib/quotes.ts";

Deno.test("quote totals: services + VAT + advances, an advance never carries VAT", () => {
  const t = quoteTotals([
    { kind: "brokerage_fee", description: "Brokerage", amount: 5000, vatable: true, advance: false },
    { kind: "trucking", description: "Trucking", amount: 9500, vatable: true, advance: false },
    { kind: "duties_taxes", description: "Duties (estimate)", amount: 104450.32, vatable: true, advance: true },
  ]);
  assertEquals([t.services, t.vat, t.advances, t.total], [14500, 1740, 104450.32, 120690.32]);
  assertEquals(cleanLine({ kind: "other", description: "", amount: 10.005, vatable: true, advance: true }).vatable, false);
});

Deno.test("expired: only open quotes past their date", () => {
  assertEquals(isExpired({ status: "sent", valid_until: "2026-11-20" }, "2026-11-24"), true);
  assertEquals(isExpired({ status: "accepted", valid_until: "2026-11-20" }, "2026-11-24"), false);
  assertEquals(isExpired({ status: "draft", valid_until: "2026-11-24" }, "2026-11-24"), false);
});
