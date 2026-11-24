import { assert, assertEquals } from "jsr:@std/assert@1";
import { draftReminder, mailtoLink, payerScore, toneFor } from "../src/lib/chase.ts";

Deno.test("payer score from fully paid billings", () => {
  const h = (late: number, onTime: number) => [
    ...Array.from({ length: late }, () => ({ due: "2026-10-01", paidOn: "2026-10-05" })),
    ...Array.from({ length: onTime }, () => ({ due: "2026-10-01", paidOn: "2026-10-01" })),
  ];
  assertEquals(payerScore(h(1, 1)), "occasional"); // fewer than 3
  assertEquals(payerScore(h(1, 3)), "good");       // 25% late
  assertEquals(payerScore(h(2, 2)), "occasional"); // 50% late
  assertEquals(payerScore(h(3, 1)), "repeat");     // 75% late
});

Deno.test("tone: history first, firmer with age", () => {
  assertEquals(toneFor("good", 10), "gentle");
  assertEquals(toneFor("good", 31), "neutral");
  assertEquals(toneFor("good", 61), "firm");
  assertEquals(toneFor("occasional", 5), "neutral");
  assertEquals(toneFor("repeat", 2), "firm");
});

const items = [
  { pn: "HNC10-749-26", soa: "SOA-0101", billedOn: "2026-09-01", due: "2026-10-01", daysOverdue: 54, balance: 12500 },
  { pn: "HNC10-750-26", soa: null, billedOn: "2026-10-01", due: "2026-10-31", daysOverdue: 24, balance: 7500.5 },
];

Deno.test("firm reminder: every shipment, total, pay-by date a week out, 2307 line", () => {
  const r = draftReminder({ client: "HONDA TRADING", items, tone: "firm", today: "2026-11-24", sender: "Maria", paymentInstructions: "BDO 0000-0000-00", withholdsTax: true });
  assertEquals(r.subject, "Past due notice: ₱20,000.50, 54 days overdue");
  assertEquals(r.payBy, "2026-12-01");
  assert(r.body.includes("- PN HNC10-749-26, SOA no. SOA-0101: ₱12,500.00, billed September 1, 2026, due October 1, 2026 (54 days overdue)"));
  assert(r.body.includes("- PN HNC10-750-26: ₱7,500.50"));
  assert(r.body.includes("Total amount due: ₱20,000.50"));
  assert(r.body.includes("on or before December 1, 2026"));
  assert(r.body.includes("BDO 0000-0000-00"));
  assert(r.body.includes("BIR Form 2307"));
  assert(r.body.startsWith("Dear HONDA TRADING,"));
});

Deno.test("gentle reminder: one billing, no pay-by date, no 2307 line unless the client withholds", () => {
  const r = draftReminder({ client: "GEOCON", items: [items[1]], tone: "gentle", today: "2026-11-24", sender: "Maria" });
  assertEquals(r.subject, "Friendly reminder: VSA billing for ₱7,500.50");
  assertEquals(r.payBy, null);
  assert(r.body.includes("billing from VSA Customs Brokerage is now past due"));
  assert(!r.body.includes("2307"));
});

Deno.test("mail link keeps line breaks and symbols", () => {
  const link = mailtoLink("a@b.ph", "Past due: ₱1", "Line 1\nLine 2 & more");
  assertEquals(link, "mailto:a%40b.ph?subject=Past%20due%3A%20%E2%82%B11&body=Line%201%0ALine%202%20%26%20more");
});
