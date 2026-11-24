import { assertEquals } from "jsr:@std/assert@1";
import { billedCollected, countBySteps, lastMonths, monthLabel, niceMax, shortPeso } from "../src/lib/dashboard.ts";

Deno.test("last 12 months end with this month, across the year change", () => {
  const m = lastMonths("2026-11-24");
  assertEquals([m.length, m[0], m[11]], [12, "2025-12", "2026-11"]);
  assertEquals(lastMonths("2026-01-05", 3), ["2025-11", "2025-12", "2026-01"]);
  assertEquals([monthLabel("2026-11"), monthLabel("2026-11", true)], ["Nov", "Nov 2026"]);
});

Deno.test("billed by billed date; collected by payment date, 2307 included", () => {
  const r = billedCollected(
    [{ billed_on: "2026-10-03", total: 11200 }, { billed_on: "2026-11-01", total: 7500.5 }, { billed_on: null, total: 999 }],
    [{ paid_on: "2026-11-10", amount: 4900, ewt_amount: 100 }, { paid_on: "2026-11-12", amount: 1000 }],
    ["2026-10", "2026-11"],
  );
  assertEquals(r, [{ month: "2026-10", billed: 11200, collected: 0 }, { month: "2026-11", billed: 7500.5, collected: 6000 }]);
});

Deno.test("steps: released counts as delivered", () => {
  assertEquals(countBySteps(["lodged", "released", "delivered", "lodged"], ["lodged", "delivered"]), [{ step: "lodged", count: 2 }, { step: "delivered", count: 2 }]);
});

Deno.test("axis tops and short pesos", () => {
  assertEquals([niceMax(0), niceMax(7), niceMax(180000), niceMax(2.6e6)], [1, 10, 200000, 5e6]);
  assertEquals([shortPeso(900), shortPeso(1500), shortPeso(350000), shortPeso(1234567), shortPeso(25e6)], ["₱900", "₱1.5K", "₱350K", "₱1.2M", "₱25M"]);
});
