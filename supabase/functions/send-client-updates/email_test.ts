import { assert, assertEquals } from "jsr:@std/assert@1";
import { buildEmail } from "./email.ts";

const job = { job_no: "PN-0101", client_ref_no: "PO 55", bl_awb_no: "MEDU123", containers: ["MSCU1234565", "MSCU7654321"],
  vessel: "MSC ANNA", voyage: "045W", eta: "2026-11-20", vessel_note: "Anchored at Manila Bay" };

Deno.test("subject names the step and the client's own reference", () => {
  const m = buildEmail("lodged", "Acme Foods", job, null);
  assertEquals(m.subject, "VSA Customs Brokerage: Entry lodged (your ref. PO 55)");
  assert(m.text.includes("Containers: MSCU1234565, MSCU7654321"));
  assert(m.text.includes("Latest vessel position: Anchored at Manila Bay"));
  assert(!m.text.includes("See all your shipments"));
});

Deno.test("falls back to BL, then PN, and includes the client page link when on", () => {
  const m = buildEmail("delivered", "Acme", { ...job, client_ref_no: null }, "https://x.test/track/abc");
  assert(m.subject.endsWith("(BL MEDU123)"));
  assert(m.text.includes("https://x.test/track/abc"));
  const n = buildEmail("assessed", "Acme", { ...job, client_ref_no: null, bl_awb_no: null }, null);
  assert(n.subject.endsWith("(PN PN-0101)"));
});

Deno.test("typed text is escaped in the HTML", () => {
  const m = buildEmail("paid", "<script>x</script>", { ...job, vessel_note: "a & b <i>" }, null);
  assert(!m.html.includes("<script>"));
  assert(m.html.includes("a &amp; b &lt;i&gt;"));
});
