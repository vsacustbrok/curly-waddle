import { assertEquals } from "jsr:@std/assert@1";
import { copyIsDue, daysSince, readme, safeName, zipPaths, type DocRow } from "../src/lib/offsite.ts";

Deno.test("reminder after 7 days, or when never made", () => {
  const now = new Date("2026-11-21T09:00:00+08:00");
  assertEquals(daysSince(null, now), null);
  assertEquals(copyIsDue(null, now), true);
  assertEquals(copyIsDue("2026-11-15T10:00:00+08:00", now), false);
  assertEquals(daysSince("2026-11-14T09:00:00+08:00", now), 7);
  assertEquals(copyIsDue("2026-11-14T09:00:00+08:00", now), true);
});

Deno.test("names are safe and never collide", () => {
  assertEquals(safeName('BL: 123/45?.pdf'), "BL_ 123_45_.pdf");
  assertEquals(safeName("..hidden"), "hidden");
  const d = (id: string, name: string, pn: string | null): DocRow => ({ id, file_path: `x/${id}.pdf`, file_name: name, size_bytes: 1, uploaded_at: "", jobs: pn ? { job_no: pn } : null });
  const m = zipPaths([d("1", "BL.pdf", "PN26-00012"), d("2", "bl.pdf", "PN26-00012"), d("3", "BL.pdf", "PN26-00013"), d("4", "Invoice", null)]);
  assertEquals(m.get("1"), "documents/PN26-00012/BL.pdf");
  assertEquals(m.get("2"), "documents/PN26-00012/bl (2).pdf");
  assertEquals(m.get("3"), "documents/PN26-00013/BL.pdf");
  assertEquals(m.get("4"), "documents/no PN/Invoice");
});

Deno.test("read-me lists missing files", () => {
  const t = readme(new Date(), null, 2, ["documents/A/x.pdf"], null);
  assertEquals(t.includes("NOT in this copy"), true);
  assertEquals(t.includes("documents/A/x.pdf"), true);
});
