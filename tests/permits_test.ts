import { assertEquals } from "jsr:@std/assert@1";
import { clientWarnings, stateOf, warningText, type Permit } from "../src/lib/permits.ts";

const p = (x: Partial<Permit>): Permit => ({ id: 1, client_id: "c1", kind: "boc_accreditation", title: null, reference_no: null, issued_on: null, expires_on: "2026-12-31", note: null, renewed: false, ...x });

Deno.test("state: expired after the day, soon within 30 days, renewed never warns", () => {
  const today = "2026-11-24";
  assertEquals(stateOf(p({ expires_on: "2026-11-23" }), today), "expired");
  assertEquals(stateOf(p({ expires_on: "2026-11-24" }), today), "soon");
  assertEquals(stateOf(p({ expires_on: "2026-12-24" }), today), "soon");
  assertEquals(stateOf(p({ expires_on: "2026-12-25" }), today), "ok");
  assertEquals(stateOf(p({ expires_on: "2026-01-01", renewed: true }), today), "renewed");
});

Deno.test("warning sentences", () => {
  assertEquals(warningText(p({ expires_on: "2026-11-21" }), "2026-11-24"), "BOC importer accreditation expired 3 days ago");
  assertEquals(warningText(p({ kind: "fda_cpr", title: "Frozen MDM", expires_on: "2026-11-25" }), "2026-11-24"), "FDA product registration (CPR): Frozen MDM expires in 1 day");
});

Deno.test("client warnings: only that client's lapsed or lapsing, earliest first", () => {
  const list = [p({ id: 1, expires_on: "2026-12-10" }), p({ id: 2, expires_on: "2026-11-01" }), p({ id: 3, client_id: "c2", expires_on: "2026-11-01" }),
    p({ id: 4, expires_on: "2027-06-01" }), p({ id: 5, expires_on: "2026-10-01", renewed: true })];
  assertEquals(clientWarnings(list, "c1", "2026-11-24").map((x) => x.id), [2, 1]);
});
