import { assertEquals } from "jsr:@std/assert@1";
import { byGroup, daysOf, median, type TJob } from "../src/lib/turnaround.ts";

const j = (p: Partial<TJob>): TJob => ({ id: "j1", job_no: "PN1", eta: null, entry_filed_date: null, released_at: null, billed_on: null, ...p });

Deno.test("days per stretch from the shipment's dates", () => {
  assertEquals(daysOf(j({ eta: "2026-11-01", entry_filed_date: "2026-11-03", released_at: "2026-11-08T10:00:00+08:00", billed_on: "2026-11-15" }), []),
    { arrivalToLodged: 2, lodgedToReleased: 5, releasedToBilled: 7, lodgedToBilled: 12 });
});

Deno.test("missing release and billed dates come from the first move in the step history", () => {
  const h = [
    { job_id: "j1", to_status: "delivered", changed_at: "2026-11-09T02:00:00Z" },
    { job_id: "j1", to_status: "released", changed_at: "2026-11-07T02:00:00Z" },
    { job_id: "j1", to_status: "billed", changed_at: "2026-11-20T02:00:00Z" },
    { job_id: "j2", to_status: "billed", changed_at: "2026-11-04T02:00:00Z" },
  ];
  assertEquals(daysOf(j({ entry_filed_date: "2026-11-03" }), h), { lodgedToReleased: 4, releasedToBilled: 13, lodgedToBilled: 17 });
});

Deno.test("impossible dates are left out, not counted as zero", () => {
  assertEquals(daysOf(j({ eta: "2026-11-10", entry_filed_date: "2026-11-03", released_at: "2028-01-01" }), []), {});
});

Deno.test("median and per-group rows, busiest first", () => {
  assertEquals([median([]), median([5]), median([1, 9, 3]), median([2, 4, 6, 10])], [null, 5, 3, 5]);
  const rows = byGroup([
    { group: "GEOCON", days: { lodgedToReleased: 4 } },
    { group: "HONDA", days: { lodgedToReleased: 2, releasedToBilled: 10 } },
    { group: "HONDA", days: { lodgedToReleased: 6 } },
  ]);
  assertEquals(rows.map((r) => [r.name, r.shipments, r.lodgedToReleased.median, r.lodgedToReleased.n, r.releasedToBilled.median]),
    [["HONDA", 2, 4, 2, 10], ["GEOCON", 1, 4, 1, null]]);
});
