import { assertEquals } from "jsr:@std/assert@1";
import { daysOpen, sumsOf } from "../src/lib/advances.ts";

const line = (p: Partial<{ kind: "spent" | "returned" | "reimbursed"; amount: number; billable: boolean; job_id: string | null; charge_id: number | null }>) =>
  ({ kind: "spent" as const, amount: 0, billable: true, job_id: "j1", charge_id: null, ...p });

Deno.test("balance = given − spent − returned; unbilled only billable spending on a shipment", () => {
  const s = sumsOf({ amount: 20000 }, [
    line({ amount: 12608 }),                              // arrastre, not yet billed
    line({ amount: 779.05, charge_id: 5 }),               // wharfage, already billed
    line({ amount: 150, billable: false }),               // office cost (parking)
    line({ amount: 300, job_id: null }),                  // no shipment chosen yet
    line({ kind: "returned", amount: 6000 }),
  ]);
  assertEquals(s, { given: 20000, spent: 13837.05, returned: 6000, reimbursed: 0, balance: 162.95, unbilled: 12608, needsPn: 1 });
});

Deno.test("spent more than given: the office owes the person", () => {
  assertEquals(sumsOf({ amount: 5000 }, [line({ amount: 5250 })]).balance, -250);
  // The office pays the ₱250 back: settled.
  assertEquals(sumsOf({ amount: 5000 }, [line({ amount: 5250 }), line({ kind: "reimbursed", amount: 250 })]).balance, 0);
});

Deno.test("days open", () => {
  assertEquals(daysOpen("2026-11-17", "2026-11-24"), 7);
});
