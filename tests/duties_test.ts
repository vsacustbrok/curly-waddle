// Run: deno test tests/  (from the project folder)
// The expected figures in duties_expected.json come from the office's own
// "VSA Duties and Taxes Computation" calculator, run on the same inputs.
import { assert, assertAlmostEquals, assertEquals } from "jsr:@std/assert@1";
import { blankItem, brokerageFee, compute, DEFAULT_SETTINGS, defaultInput, ipcFee, safeguardChicken, tsadLines, type DutyInput } from "../src/lib/duties.ts";

const expected = JSON.parse(await Deno.readTextFile(new URL("./duties_expected.json", import.meta.url)));
const close = (a: number, b: number) => assertAlmostEquals(a, b, 0.005);
const one = (over: Partial<DutyInput>, item: Partial<ReturnType<typeof blankItem>>): DutyInput =>
  ({ ...defaultInput(), ...over, items: [{ ...blankItem(), ...item }] });

Deno.test("formal entry, one item, matches the office calculator", () => {
  const r = compute(one({ exchangeRate: 58.25, freight: 1500, insurancePct: null, insuranceAmount: 120 }, { fob: 48000, rate: 40 }));
  const e = expected.formal_basic;
  for (const [mine, theirs] of [[r.dvPhp, e.dvPhp], [r.duty, e.duty], [r.brokerage, e.brokerage], [r.arrastre, e.arr], [r.wharfage, e.whf],
    [r.landedCost, e.tlc], [r.vat, e.vat], [r.subTotal, e.sub], [r.total, e.total]]) close(mine, theirs);
  const t = tsadLines(r, false);
  for (const k of ["dv", "bf", "tot", "vatFull", "item", "cds", "glob", "grand"]) close((t as Record<string, number>)[k], e.tsad[k]);
});

Deno.test("formal entry with insurance %, other charges, 20-foot container and bank charges", () => {
  const r = compute(one({ exchangeRate: 56.1, freight: 200, insurancePct: 2, otherCharges: 50, container: "20ft", bank: 125 }, { fob: 3000, rate: 5 }));
  const e = expected.formal_big;
  for (const [mine, theirs] of [[r.dvPhp, e.dvPhp], [r.duty, e.duty], [r.brokerage, e.brokerage], [r.landedCost, e.tlc], [r.vat, e.vat], [r.total, e.total]]) close(mine, theirs);
});

Deno.test("chicken safeguard and a VAT exemption match the office calculator", () => {
  const r = compute(one({ exchangeRate: 58, freight: 3000, insurancePct: null, insuranceAmount: 0, arrastre: 8000, wharfage: 800, exempt: "vat" },
    { fob: 40000, rate: 40, chickenNetKg: 27000 }), { ...DEFAULT_SETTINGS, chickenTriggerPrice: 1.2 });
  const e = expected.formal_chicken_exempt;
  close(r.safeguard, e.sg); close(r.vat, 0); close(r.vatFull, e.vatFull); close(r.total, e.total);
  close(tsadLines(r, true).grand, e.tsad.grand);
});

Deno.test("informal entry (express) matches the office calculator", () => {
  const r = compute(one({ mode: "informal", exchangeRate: 58.25, freight: 40, insurancePct: 2 }, { fob: 450, rate: 15 }));
  const e = expected.informal;
  for (const [mine, theirs] of [[r.dvPhp, e.dvPhp], [r.duty, e.duty], [r.ipf, e.ipc], [r.landedCost, e.tlc], [r.vat, e.vat], [r.total, e.total]]) close(mine, theirs);
});

Deno.test("several items: charges shared by value, each item at its own rate, fees once", () => {
  const base = { exchangeRate: 58, freight: 1000, insurancePct: null, insuranceAmount: 100 } as const;
  const r = compute({ ...defaultInput(), ...base, items: [
    { ...blankItem(), description: "Frozen chicken", fob: 30000, rate: 40 },
    { ...blankItem(), description: "Frozen pork", fob: 10000, rate: 30 },
  ] });
  assertEquals(r.items.length, 2);
  close(r.items[0].freight, 750); close(r.items[1].freight, 250);
  close(r.items[0].insurance, 75); close(r.items[1].insurance, 25);
  close(r.dvPhp, (40000 + 1100) * 58);
  close(r.duty, (30825 * 58) * 0.40 + (10275 * 58) * 0.30);
  close(r.brokerage, brokerageFee(r.dvPhp).fee);
  // Two items at the same rate give the same answer as one combined item.
  const split = compute({ ...defaultInput(), ...base, items: [{ ...blankItem(), fob: 30000, rate: 40 }, { ...blankItem(), fob: 10000, rate: 40 }] });
  const whole = compute(one(base, { fob: 40000, rate: 40 }));
  close(split.total, whole.total);
});

Deno.test("quota rates replace the rate of duty; missing rates are counted", () => {
  const r = compute({ ...defaultInput(), exchangeRate: 58, items: [
    { ...blankItem(), fob: 1000, rate: 15, quota: "pork_in" },
    { ...blankItem(), fob: 1000, rate: 15, quota: "pork_out" },
    { ...blankItem(), fob: 1000, rate: null },
  ] });
  assertEquals(r.items.map((i) => i.rateUsed), [30, 40, 0]);
  assertEquals(r.missingRates, 1);
  assert(r.conditions.some((c) => c.includes("MAV Import Certificate")));
});

Deno.test("fee tables at their boundaries", () => {
  assertEquals(brokerageFee(10000).fee, 1300); assertEquals(brokerageFee(10000.01).fee, 2000);
  assertEquals(brokerageFee(200000).fee, 5300); close(brokerageFee(1000000).fee, 5300 + 800000 * 0.00125);
  assertEquals(ipcFee(25000), 250); assertEquals(ipcFee(25001), 500); assertEquals(ipcFee(800000), 2000); assertEquals(ipcFee(0), 0);
  assertEquals(safeguardChicken(105, 100, 1).sgUsd, 0); // 5% over the trigger price: no safeguard duty
  close(safeguardChicken(150, 100, 1).sgUsd, 0.50 * (0.5 - 0.40) * 100); // 50% over: band 40-60%
});

Deno.test("several containers multiply the standard arrastre and wharfage", () => {
  const r = compute(one({ exchangeRate: 58, containers: 3, container: "40ft" }, { fob: 1000, rate: 0 }));
  close(r.arrastre, 7436 * 3); close(r.wharfage, 779.05 * 3);
});
