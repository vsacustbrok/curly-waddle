import { assert, assertEquals } from "jsr:@std/assert@1";
import { GUIDES, guidesFor } from "../src/lib/guide.ts";

Deno.test("every guide is complete and ids are unique", () => {
  assertEquals(new Set(GUIDES.map((g) => g.id)).size, GUIDES.length);
  for (const g of GUIDES) assert(g.title && g.who && g.when && g.steps.length >= 2 && g.roles.length, g.id);
});

Deno.test("riders see only rider guides; office sees theirs first, then the rest", () => {
  const r = guidesFor("rider");
  assertEquals(r.mine.map((g) => g.id), ["rider"]);
  assertEquals(r.others.length, 0);
  const b = guidesFor("billing");
  assert(b.mine.some((g) => g.id === "bir"));
  assert(b.others.some((g) => g.id === "new-shipment"));
  assertEquals(b.mine.length + b.others.length, GUIDES.length);
});

Deno.test("search matches every word, any case", () => {
  assertEquals(guidesFor("owner", "2307").mine.map((g) => g.id).sort(), ["books", "payments"].sort());
  assertEquals(guidesFor("owner", "PHOTO receipt").mine.map((g) => g.id), ["rider"]);
  assertEquals(guidesFor("owner", "zzzz").mine.length, 0);
});
