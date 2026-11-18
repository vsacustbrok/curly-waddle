// The real E2M SAD C 439702 (Hexagon Nutrifood, frozen chicken MDM), recomputed: every figure must match it.
import { assertAlmostEquals } from "jsr:@std/assert@1";
import { blankItem, compute, defaultInput, tsadLines } from "../src/lib/duties.ts";

Deno.test("recomputes the SAD C 439702 to the centavo", () => {
  const fx = 63.559;
  const r = compute({ ...defaultInput(), exchangeRate: fx, freight: 127118 / fx, insurancePct: 4, arrastre: 12608, wharfage: 779.05,
    cds: 130, ipf: 2000, irs: 30, csf: 635, exempt: "vat",
    items: [{ ...blankItem(), description: "Frozen chicken MDM", ahtn: "02071491", fob: 29680, rate: 5 }] });
  const t = tsadLines(r, true);
  const eq = (a: number, b: number) => assertAlmostEquals(a, b, 0.006);
  eq(t.dv, 2089006.36); eq(t.duty, 104450.32); eq(t.bf, 7661.26); eq(t.whf, 779.05); eq(t.arr, 12608); eq(t.stamp, 130); eq(t.oth, 2000);
  eq(t.tot, 2216634.99); eq(t.vat, 0);
  eq(t.cud, 104450.32); eq(t.item, 104450.32); eq(t.ipc, 2000); eq(t.csf, 635); eq(t.cds, 100); eq(t.irs, 30); eq(t.glob, 2765); eq(t.grand, 107215.32);
});
