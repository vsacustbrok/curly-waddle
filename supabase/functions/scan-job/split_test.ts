import { assertEquals } from "jsr:@std/assert@1";
import { validRanges } from "./extract.ts";

Deno.test("page ranges must cover every page once, in order", () => {
  const ok = [{ first_page: 1, last_page: 2 }, { first_page: 3, last_page: 3 }, { first_page: 4, last_page: 7 }];
  assertEquals(validRanges(ok, 7), ok);
  assertEquals(validRanges(ok, 8), null); // last page missing
  assertEquals(validRanges([{ first_page: 2, last_page: 7 }], 7), null); // first page missing
  assertEquals(validRanges([{ first_page: 1, last_page: 3 }, { first_page: 3, last_page: 7 }], 7), null); // overlap
  assertEquals(validRanges([{ first_page: 1, last_page: 2 }, { first_page: 4, last_page: 7 }], 7), null); // gap
  assertEquals(validRanges([{ first_page: 1, last_page: 0 }], 7), null);
  assertEquals(validRanges([], 3), null);
  assertEquals(validRanges("x", 3), null);
});
