import assert from "node:assert/strict";
import test from "node:test";
import {
  parseShowtimeExperienceTypes,
  showtimeMatchesExperienceTypes
} from "./experience-types";

test("parses, deduplicates, and orders supported experience types", () => {
  assert.deepEqual(parseShowtimeExperienceTypes(["dolby atmos,imax", "IMAX", "unknown"]), [
    "IMAX",
    "Dolby Atmos"
  ]);
});

test("matches selected types with OR semantics and exact format tokens", () => {
  assert.equal(showtimeMatchesExperienceTypes("UltraAVX, Dolby Atmos", ["UltraAVX"]), true);
  assert.equal(showtimeMatchesExperienceTypes("UltraAVX, Dolby Atmos", ["IMAX", "3D"]), false);
  assert.equal(showtimeMatchesExperienceTypes("IMAX, 3D", ["3D", "D-BOX"]), true);
  assert.equal(showtimeMatchesExperienceTypes("UltraAVX", ["VIP"]), false);
});

test("matches Cineplex VIP variants and leaves an empty selection unfiltered", () => {
  assert.equal(showtimeMatchesExperienceTypes("VIP 19+, Recliner", ["VIP"]), true);
  assert.equal(showtimeMatchesExperienceTypes(undefined, []), true);
});
