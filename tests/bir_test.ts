import { assertEquals } from "jsr:@std/assert@1";
import { collectionsBook, missingSetup, pesoWords, salesBook, vatSummary, type BirDoc, type BirSettings } from "../src/lib/bir.ts";

const base = { job_id: "j", payment_id: null, issued_at: "", issued_by_name: null, buyer_tin: null, buyer_address: null,
  zero_rated: 0, amount_received: null, ewt_amount: 0, seller: {}, void_reason: null, voided_at: null, lines: [] as BirDoc["lines"] };
const inv = (n: number, vatable: number, voided = false): BirDoc => ({ ...base, id: n, doc_type: "invoice", serial_no: n, doc_no: `SI-${n}`,
  issued_on: "2026-11-20", buyer_name: "A", vatable_sales: vatable, vat_amount: vatable * 0.12, exempt_sales: 0, total: vatable * 1.12, voided,
  void_reason: voided ? "wrong amount" : null });
const rec = (n: number, cash: number, ewt: number): BirDoc => ({ ...base, id: 100 + n, doc_type: "receipt", serial_no: n, doc_no: `CR-${n}`,
  issued_on: "2026-11-20", buyer_name: "A", vatable_sales: 0, vat_amount: 0, exempt_sales: 0, total: cash + ewt, amount_received: cash, ewt_amount: ewt, voided: false });

Deno.test("amounts in words, as on a receipt", () => {
  assertEquals(pesoWords(6740), "Six Thousand Seven Hundred Forty Pesos and 00/100");
  assertEquals(pesoWords(1234567.5), "One Million Two Hundred Thirty-Four Thousand Five Hundred Sixty-Seven Pesos and 50/100");
  assertEquals(pesoWords(0.75), "Zero Pesos and 75/100");
});

Deno.test("books: a void invoice keeps its number with zero amounts; totals skip it", () => {
  const docs = [inv(2, 1000), inv(1, 5000, true), rec(1, 980, 20)];
  const book = salesBook(docs);
  assertEquals(book.map((r) => r["Invoice no."]), ["SI-1", "SI-2"]);
  assertEquals(book[0].Total, 0);
  assertEquals(String(book[0].Status).startsWith("VOID"), true);
  const s = vatSummary(docs);
  assertEquals([s.invoices, s.voided, s.vatable, s.vat, s.ewt, s.collected], [1, 1, 1000, 120, 20, 980]);
  assertEquals(collectionsBook(docs)[0]["Total settled"], 1000);
});

Deno.test("issuing stays off until the BIR details are complete", () => {
  const s: BirSettings = { registered_name: "VSA", trade_name: null, tin: "000-111-222", branch_code: "00000", address: "Manila", vat_registered: true,
    permit_no: null, permit_date: null, invoice_prefix: "", invoice_from: 1, invoice_to: 5000, receipt_prefix: "", receipt_from: null, receipt_to: null };
  assertEquals(missingSetup(s, "invoice"), ["BIR permit / acknowledgement certificate no."]);
  assertEquals(missingSetup({ ...s, permit_no: "AC-1" }, "invoice"), []);
  assertEquals(missingSetup({ ...s, permit_no: "AC-1" }, "receipt"), ["collection receipt number series"]);
});
