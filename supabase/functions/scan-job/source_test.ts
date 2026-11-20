import { assertEquals } from "jsr:@std/assert@1";
import { sourceFor } from "./extract.ts";

const base = { size: 10_000_000, name: "HC.pdf", declaredType: "other" };
Deno.test("big PDFs are sent by private link, not by contents", () => {
  const s = sourceFor({ ...base, mime: "application/pdf", url: "https://x.test/a.pdf" }, true);
  assertEquals(s, { type: "document", source: { type: "url", url: "https://x.test/a.pdf" } });
});
Deno.test("photos by link use the image type", () => {
  const s = sourceFor({ ...base, mime: "image/jpeg", url: "https://x.test/a.jpg" }, true);
  assertEquals(s?.type, "image");
});
Deno.test("fallback sends the contents when we have them, and gives up cleanly when we do not", () => {
  const bytes = new TextEncoder().encode("%PDF-1.4 test");
  const s = sourceFor({ ...base, size: bytes.length, mime: "application/pdf", url: "https://x", bytes }, false);
  assertEquals(s?.source.type, "base64");
  assertEquals((s?.source as { data: string }).data, btoa("%PDF-1.4 test"));
  assertEquals(sourceFor({ ...base, mime: "application/pdf", url: "https://x" }, false), null);
});
Deno.test("CSV from Excel is sent as text", () => {
  const bytes = new TextEncoder().encode("a,b\n1,2");
  const s = sourceFor({ ...base, size: 7, mime: "text/csv", url: "https://x", bytes }, true);
  assertEquals(s, { type: "document", source: { type: "text", media_type: "text/plain", data: "a,b\n1,2" } });
});
