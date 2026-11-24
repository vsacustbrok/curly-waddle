import { assertEquals } from "jsr:@std/assert@1";
import { freeTime, isTwenty, lineKey, moneyAtRisk, ruleFor, type FreeJob, type FreeRule } from "../src/lib/freetime.ts";

const rules: FreeRule[] = [
  { kind: "demurrage", name: "Default", free_days: 7, rate_20: 1000, rate_40: 2000 },
  { kind: "demurrage", name: "Maersk Line", free_days: 10, rate_20: 1500, rate_40: 3000 },
  { kind: "storage", name: "Default", free_days: 5, rate_20: 500, rate_40: 1000 },
];
const job = (p: Partial<FreeJob> = {}): FreeJob => ({
  status: "lodged", eta: "2026-11-10", carrier: "MAERSK LINES", container_size: "40", containers: ["MSKU1234567", "MSKU7654321"],
  storage_free_until: null, demurrage_free_until: null, ...p,
});

Deno.test("line names match without company words; unknown lines use Default", () => {
  assertEquals(lineKey("MAERSK LINES"), lineKey("Maersk Line"));
  assertEquals(lineKey("EVERGREEN LINE"), lineKey("Evergreen"));
  assertEquals(ruleFor(rules, "demurrage", "MAERSK LINES")?.name, "Maersk Line");
  assertEquals(ruleFor(rules, "demurrage", "COSCO SHIPPING")?.name, "Default");
  assertEquals(ruleFor(rules, "demurrage", null)?.name, "Default");
});

Deno.test("container size: 20 only when it says 20", () => {
  assertEquals([isTwenty("20"), isTwenty("20GP"), isTwenty("1x20'"), isTwenty("40"), isTwenty("40HC"), isTwenty(null)], [true, true, true, false, false, false]);
});

Deno.test("estimated from ETA: ETA is day 1 of free time", () => {
  // Storage: 5 free days from Nov 10 → last free day Nov 14; on Nov 20 that is 6 days over × 2 × ₱1,000.
  const [st, dm] = freeTime(job(), rules, "2026-11-20");
  assertEquals([st.kind, st.until, st.estimated, st.daysOver, st.amount], ["storage", "2026-11-14", true, 6, 12000]);
  // Demurrage (Maersk, 10 days) → last free day Nov 19; 1 day over × 2 × ₱3,000; in 3 days: 4 × 2 × 3,000.
  assertEquals([dm.until, dm.daysOver, dm.amount, dm.in3Days], ["2026-11-19", 1, 6000, 24000]);
  assertEquals(moneyAtRisk([st, dm]), { now: 18000, in3Days: 18000 + 6000 + 24000 - 6000, missingRate: false });
});

Deno.test("a date typed on the shipment wins over the estimate", () => {
  const [st] = freeTime(job({ storage_free_until: "2026-11-25" }), rules, "2026-11-20");
  assertEquals([st.until, st.estimated, st.daysOver, st.amount, st.in3Days], ["2026-11-25", false, 0, 0, 0]);
});

Deno.test("no charges for air or loose cargo, or once the container is out", () => {
  assertEquals(freeTime(job({ containers: [] }), rules, "2026-11-20"), []);
  assertEquals(freeTime(job({ status: "delivered" }), rules, "2026-11-20"), []);
  assertEquals(freeTime(job({ eta: null }), rules, "2026-11-20"), []);
});

Deno.test("a rate not set yet: days still counted, amount unknown", () => {
  const noRates = rules.map((r) => ({ ...r, rate_20: null, rate_40: null }));
  const lines = freeTime(job(), noRates, "2026-11-20");
  assertEquals(lines.map((l) => [l.daysOver, l.amount]), [[6, null], [1, null]]);
  assertEquals(moneyAtRisk(lines).missingRate, true);
});
