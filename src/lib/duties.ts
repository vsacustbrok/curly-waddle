// Duties and taxes computation, following the office's "VSA Duties and Taxes Computation - Informal and
// Formal Entry" calculator, extended to shipments with several items (one line per item, each with its
// own AHTN code and rate). Pure functions, no screen code: tested in tests/duties_test.ts.
//
// Several items: freight, insurance and other charges are shared out over the items in proportion to
// each item's FOB value; each item's duty uses its own rate. The fees (brokerage, arrastre, wharfage,
// CDS, IPF, bank charges, IRS) are charged once per entry. With one item the figures equal the office
// calculator exactly. Every figure is an estimate; the BOC assessment is final.

export type Mode = "formal" | "informal";
export type Quota = "none" | "pork_in" | "pork_out" | "beef_in" | "beef_out";
export type Container = "40ft" | "20ft" | "lcl";

export type DutySettings = {
  /** Formal entry, brokerage fee by dutiable value (CAO 1-2001); above the last: last fee + overRate x excess. */
  brokerage: { upto: number; fee: number }[];
  brokerageOverRate: number;
  /** Arrastre and wharfage per container when left blank. */
  port: Record<Container, { arr: number; whf: number }>;
  cds: number; ipf: number; irs: number;
  vatRate: number;
  /** Safeguard duty on chicken: trigger price in USD per kg. */
  chickenTriggerPrice: number;
  porkInRate: number; porkOutRate: number; beefInRate: number | null; beefOutRate: number | null;
  /** Informal entry (express couriers). */
  informal: { brokerageFee: number; birDst: number; customsDs: number; ipc: { upto: number | null; fee: number }[] };
};

export const DEFAULT_SETTINGS: DutySettings = {
  brokerage: [
    { upto: 10000, fee: 1300 }, { upto: 20000, fee: 2000 }, { upto: 30000, fee: 2700 }, { upto: 40000, fee: 3300 },
    { upto: 50000, fee: 3600 }, { upto: 60000, fee: 4000 }, { upto: 100000, fee: 4700 }, { upto: 200000, fee: 5300 },
  ],
  brokerageOverRate: 0.00125,
  port: { "40ft": { arr: 7436, whf: 779.05 }, "20ft": { arr: 5496, whf: 519.35 }, lcl: { arr: 110, whf: 34 } },
  cds: 130, ipf: 1500, irs: 30, vatRate: 0.12,
  chickenTriggerPrice: 93.96,
  porkInRate: 30, porkOutRate: 40, beefInRate: null, beefOutRate: null,
  informal: {
    brokerageFee: 700, birDst: 30, customsDs: 100,
    ipc: [{ upto: 25000, fee: 250 }, { upto: 50000, fee: 500 }, { upto: 250000, fee: 750 }, { upto: 500000, fee: 1000 }, { upto: 750000, fee: 1500 }, { upto: null, fee: 2000 }],
  },
};

export type Item = {
  description: string;
  ahtn: string;
  /** Rate of duty in %, as found for the AHTN code (MFN or FTA). */
  rate: number | null;
  /** FOB / FCA value in the invoice currency. */
  fob: number;
  quota: Quota;
  /** Safeguard duty on chicken: net weight of this item in kg; null or 0 = not applied. */
  chickenNetKg: number | null;
  /** Excise tax for this item in PHP, if any. */
  excise: number;
};

export type DutyInput = {
  mode: Mode;
  currency: string;
  exchangeRate: number;
  items: Item[];
  freight: number;
  /** Insurance: a % of FOB, or an actual amount (insuranceAmount) when insurancePct is null. */
  insurancePct: number | null;
  insuranceAmount: number;
  otherCharges: number;
  container: Container;
  containers: number;
  /** Arrastre / wharfage in PHP; null = the standard rate for the container type x number of containers. */
  arrastre: number | null;
  wharfage: number | null;
  cds: number; ipf: number; irs: number; bank: number;
  exempt: "none" | "both" | "duty" | "vat";
  exemptRef: string;
};

export type ItemResult = Item & {
  share: number; freight: number; insurance: number; other: number; dvFx: number; dvPhp: number;
  rateUsed: number; rateSource: string; dutyFull: number; duty: number; safeguard: number; safeguardBand: string | null;
};

export type DutyResult = {
  items: ItemResult[];
  fob: number; insurance: number; dvFx: number; dvPhp: number;
  duty: number; dutyFull: number; excise: number;
  brokerage: number; brokerageTier: number; arrastre: number; wharfage: number; cds: number; ipf: number; bank: number; irs: number;
  birDst: number; customsDs: number;
  landedCost: number; vat: number; vatFull: number; safeguard: number;
  subTotal: number; total: number;
  conditions: string[];
  missingRates: number;
};

export const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

export function brokerageFee(dvPhp: number, s: DutySettings = DEFAULT_SETTINGS): { fee: number; tier: number } {
  for (let i = 0; i < s.brokerage.length; i++) if (dvPhp <= s.brokerage[i].upto) return { fee: s.brokerage[i].fee, tier: i };
  const last = s.brokerage[s.brokerage.length - 1];
  return { fee: (dvPhp - last.upto) * s.brokerageOverRate + last.fee, tier: s.brokerage.length };
}

export function ipcFee(dvPhp: number, s: DutySettings = DEFAULT_SETTINGS): number {
  if (!(dvPhp > 0)) return 0;
  for (const t of s.informal.ipc) if (t.upto == null || dvPhp <= t.upto) return t.fee;
  return s.informal.ipc[s.informal.ipc.length - 1].fee;
}

/** Safeguard duty for chicken, banded trigger-price formula (as on the office printout). Amounts in USD. */
export function safeguardChicken(cifUsd: number, kg: number, tp: number) {
  const P = cifUsd / kg, PD = P - tp, pPct = PD / tp;
  let sgKg = 0, band = "Price difference 10% or less: no safeguard duty";
  if (pPct <= 0.10) sgKg = 0;
  else if (pPct <= 0.40) { band = "Price difference over 10% up to 40%"; sgKg = 0.30 * (PD - 0.10 * tp); }
  else if (pPct <= 0.60) { band = "Price difference over 40% up to 60%"; sgKg = 0.50 * (PD - 0.40 * tp); }
  else if (pPct <= 0.75) { band = "Price difference over 60% up to 75%"; sgKg = 0.70 * (PD - 0.60 * tp); }
  else { band = "Price difference over 75%"; sgKg = 0.90 * (PD - 0.75 * tp); }
  return { P, PD, pPct, sgKg, sgUsd: Math.max(sgKg * kg, 0), band };
}

function quotaRate(q: Quota, s: DutySettings): { rate: number | null; label: string } | null {
  switch (q) {
    case "pork_in": return { rate: s.porkInRate, label: "MAV pork, in-quota" };
    case "pork_out": return { rate: s.porkOutRate, label: "MAV pork, out-of-quota" };
    case "beef_in": return { rate: s.beefInRate, label: "Beef, in-quota" };
    case "beef_out": return { rate: s.beefOutRate, label: "Beef, out-of-quota" };
    default: return null;
  }
}

export function compute(inp: DutyInput, s: DutySettings = DEFAULT_SETTINGS): DutyResult {
  const items = inp.items.filter((i) => num(i.fob) > 0 || i.description || i.ahtn);
  const fob = items.reduce((a, i) => a + num(i.fob), 0);
  const insuranceTotal = inp.insurancePct != null ? fob * (inp.insurancePct / 100) : Math.max(num(inp.insuranceAmount), 0);
  const fx = num(inp.exchangeRate);
  const conditions: string[] = [];
  let missingRates = 0;

  const itemResults: ItemResult[] = items.map((i) => {
    const share = fob > 0 ? num(i.fob) / fob : items.length ? 1 / items.length : 0;
    const freight = num(inp.freight) * share, insurance = insuranceTotal * share, other = num(inp.otherCharges) * share;
    const dvFx = num(i.fob) + freight + insurance + other;
    const dvPhp = dvFx * fx;
    const q = quotaRate(i.quota, s);
    const rateUsed = q ? (q.rate ?? i.rate ?? 0) : (i.rate ?? 0);
    if (!q && i.rate == null) missingRates++;
    if (q && q.rate == null && i.rate == null) missingRates++;
    const dutyFull = dvPhp * (rateUsed / 100);
    const duty = inp.exempt === "both" || inp.exempt === "duty" ? 0 : dutyFull;
    let safeguard = 0, safeguardBand: string | null = null;
    if (inp.mode === "formal" && i.chickenNetKg && i.chickenNetKg > 0) {
      // As on the office calculator: CIF per kg from FOB + freight + insurance (in USD), before other charges.
      const sg = safeguardChicken(num(i.fob) + freight + insurance, i.chickenNetKg, s.chickenTriggerPrice);
      safeguard = sg.sgUsd * fx;
      safeguardBand = sg.band;
    }
    return { ...i, share, freight, insurance, other, dvFx, dvPhp, rateUsed, rateSource: q ? q.label : "Rate of duty", dutyFull, duty, safeguard, safeguardBand };
  });

  const dvFx = itemResults.reduce((a, i) => a + i.dvFx, 0);
  const dvPhp = itemResults.reduce((a, i) => a + i.dvPhp, 0);
  const dutyFull = itemResults.reduce((a, i) => a + i.dutyFull, 0);
  const duty = itemResults.reduce((a, i) => a + i.duty, 0);
  const excise = itemResults.reduce((a, i) => a + num(i.excise), 0);
  const safeguard = itemResults.reduce((a, i) => a + i.safeguard, 0);

  for (const q of new Set(itemResults.map((i) => i.quota).filter((q) => q !== "none"))) {
    const r = quotaRate(q, s)!;
    conditions.push(`${r.label} (${r.rate ?? "rate not set"}%)${q.startsWith("pork") ? ": MAV Import Certificate required" : ""}`);
  }
  if (safeguard > 0 || itemResults.some((i) => i.chickenNetKg)) conditions.push("With safeguard duty on chicken");
  if (inp.exempt !== "none") {
    conditions.push(`Tax exempt, Department of Finance exemption (${inp.exempt === "both" ? "duty and VAT" : inp.exempt === "duty" ? "duty only" : "VAT only"})${inp.exemptRef ? ` ref ${inp.exemptRef}` : ""}`);
  }

  if (inp.mode === "informal") {
    // BOC online estimator for express shipments; each step rounded as on the office calculator.
    const ins = r2(insuranceTotal);
    const dv = r2(r2(fob + num(inp.freight) + ins) * fx);
    const exemptDuty = inp.exempt === "both" || inp.exempt === "duty";
    // One item: exactly as the office calculator (duty on the rounded dutiable value). Several: per item.
    const dutyI = exemptDuty ? 0 : items.length === 1 ? r2(dv * itemResults[0].rateUsed / 100) : r2(itemResults.reduce((a, i) => a + i.dutyFull, 0));
    const ipc = ipcFee(dv, s);
    const bf = s.informal.brokerageFee, dst = s.informal.birDst, cdsI = s.informal.customsDs;
    const landedCost = r2(dv + dutyI + excise + bf + ipc + cdsI + dst);
    const vatFull = r2(landedCost * s.vatRate);
    const vat = inp.exempt === "both" || inp.exempt === "vat" ? 0 : vatFull;
    return {
      items: itemResults, fob, insurance: insuranceTotal, dvFx, dvPhp: dv, duty: dutyI, dutyFull, excise,
      brokerage: bf, brokerageTier: -1, arrastre: 0, wharfage: 0, cds: 0, ipf: ipc, bank: 0, irs: 0, birDst: dst, customsDs: cdsI,
      landedCost, vat, vatFull, safeguard: 0, subTotal: r2(dutyI + vat + excise + ipc + dst + cdsI),
      total: r2(dutyI + vat + excise + ipc + dst + cdsI), conditions, missingRates,
    };
  }

  const n = Math.max(1, Math.round(num(inp.containers)) || 1);
  const port = s.port[inp.container] ?? s.port["40ft"];
  const arrastre = inp.arrastre != null ? inp.arrastre : port.arr * (inp.container === "lcl" ? 1 : n);
  const wharfage = inp.wharfage != null ? inp.wharfage : port.whf * (inp.container === "lcl" ? 1 : n);
  const bf = brokerageFee(dvPhp, s);
  const landedCost = dvPhp + duty + excise + bf.fee + arrastre + wharfage + num(inp.cds) + num(inp.ipf) + num(inp.bank);
  const vatFull = landedCost * s.vatRate;
  const vat = inp.exempt === "both" || inp.exempt === "vat" ? 0 : vatFull;
  const subTotal = duty + vat + excise + num(inp.ipf);
  return {
    items: itemResults, fob, insurance: insuranceTotal, dvFx, dvPhp, duty, dutyFull, excise,
    brokerage: bf.fee, brokerageTier: bf.tier, arrastre, wharfage, cds: num(inp.cds), ipf: num(inp.ipf), bank: num(inp.bank), irs: num(inp.irs),
    birDst: 0, customsDs: 0, landedCost, vat, vatFull, safeguard, subTotal, total: subTotal + num(inp.irs) + safeguard, conditions, missingRates,
  };
}

/** Lines of the Temporary Single Administrative Document (box 53 and the Free Disposal box), each rounded to centavos. */
export function tsadLines(r: DutyResult, exemptVat: boolean, s: DutySettings = DEFAULT_SETTINGS) {
  const dv = r2(r.dvPhp), bank = r2(r.bank), duty = r2(r.duty), bf = r2(r.brokerage);
  const whf = r2(r.wharfage), arr = r2(r.arrastre), stamp = r2(r.cds), oth = r2(r.ipf), excise = r2(r.excise);
  const tot = r2(dv + bank + duty + bf + whf + arr + stamp + oth + excise);
  const vatFull = r2(tot * s.vatRate);
  const vat = exemptVat ? 0 : vatFull;
  const irs = r2(r.irs), sg = r2(r.safeguard);
  const cdsFd = Math.max(r2(stamp - irs), 0);
  const item = r2(duty + vat + excise);
  const glob = r2(oth + cdsFd + irs + sg);
  return { dv, bank, duty, bf, whf, arr, stamp, oth, excise, tot, vat, vatFull, sg, cud: duty, item, ipc: oth, cds: cdsFd, irs, glob, grand: r2(item + glob) };
}

export const blankItem = (): Item => ({ description: "", ahtn: "", rate: null, fob: 0, quota: "none", chickenNetKg: null, excise: 0 });

export function defaultInput(s: DutySettings = DEFAULT_SETTINGS): DutyInput {
  return {
    mode: "formal", currency: "USD", exchangeRate: 0, items: [blankItem()], freight: 0, insurancePct: 0, insuranceAmount: 0,
    otherCharges: 0, container: "40ft", containers: 1, arrastre: null, wharfage: null, cds: s.cds, ipf: s.ipf, irs: s.irs, bank: 0,
    exempt: "none", exemptRef: "",
  };
}

/** "0207.14.91" or "02071491" -> "02071491"; anything else that is not 8 digits -> null. */
export function normAhtn(v: string | null | undefined): string | null {
  const d = (v ?? "").replace(/[.\s-]/g, "");
  return /^\d{8}$/.test(d) ? d : null;
}
export const showAhtn = (d: string) => (/^\d{8}$/.test(d) ? `${d.slice(0, 4)}.${d.slice(4, 6)}.${d.slice(6)}` : d);
