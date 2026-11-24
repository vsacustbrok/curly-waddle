import { assertEquals } from "jsr:@std/assert@1";
import { OPEN_TRIP_STATUSES, isOpenTrip, photoPath } from "../src/lib/riders.ts";

Deno.test("photo path is <rider>/<log>/<name>.jpg, as the database requires", () => {
  assertEquals(photoPath(3, 41, 1700000000000, "abc123"), "3/41/1700000000000-abc123.jpg");
  const [rider, log] = photoPath(12, 7).split("/");
  assertEquals([rider, log], ["12", "7"]);
});

Deno.test("open errands: pending, picked up, rescheduled; done and not-done are closed", () => {
  assertEquals(OPEN_TRIP_STATUSES, ["pending", "picked_up", "rescheduled"]);
  assertEquals(isOpenTrip("delivered"), false);
  assertEquals(isOpenTrip("failed"), false);
  assertEquals(isOpenTrip("picked_up"), true);
});
