import assert from "node:assert/strict";
import test from "node:test";
import {
  searchAreaSchema,
  searchParamsToRecord,
  validateSearchArea,
} from "./search-request";

test("preserves repeated theatre types when parsing search parameters", () => {
  const params = new URLSearchParams({
    location: "Toronto",
    date: "2026-08-29",
  });
  params.append("experienceTypes", "IMAX");
  params.append("experienceTypes", "UltraAVX,D-BOX");

  assert.equal(
    searchParamsToRecord(params).experienceTypes,
    "IMAX,UltraAVX,D-BOX",
  );
});

test("validates date ranges and coordinate pairs", () => {
  const parsed = searchAreaSchema.parse({
    location: "Toronto",
    date: "2026-08-29",
    endDate: "2026-08-31",
    radiusKm: "25",
  });

  assert.equal(validateSearchArea(parsed).isValid, true);
  assert.equal(
    validateSearchArea({ ...parsed, endDate: "2026-09-01" }).isValid,
    false,
  );
  assert.equal(
    validateSearchArea({ ...parsed, latitude: 43.65 }).isValid,
    false,
  );
});
