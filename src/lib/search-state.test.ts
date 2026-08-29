import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSearchParams,
  getEffectiveFilters,
  makeDefaultSearchState,
  normalizeSearchState,
  readSearchStateFromUrl
} from "./search-state";

const TODAY = "2026-08-29";

test("starts with no occupancy, time, accessibility, VIP, or format filters", () => {
  const state = makeDefaultSearchState(TODAY);

  assert.deepEqual(state.experienceTypes, []);
  assert.equal(Object.values(state.filters).some(Boolean), false);
});

test("round-trips a three-day search, formats, and Google coordinates through the URL", () => {
  const original = {
    ...makeDefaultSearchState(TODAY),
    location: "Toronto, ON",
    endDate: "2026-08-31",
    latitude: 43.6532,
    longitude: -79.3832,
    experienceTypes: ["IMAX", "UltraAVX"] as const
  };
  const parsed = readSearchStateFromUrl(`?${buildSearchParams({ ...original, experienceTypes: [...original.experienceTypes] })}`);
  const normalized = normalizeSearchState(parsed ?? {}, TODAY);

  assert.equal(normalized.endDate, "2026-08-31");
  assert.equal(normalized.latitude, 43.6532);
  assert.equal(normalized.longitude, -79.3832);
  assert.deepEqual(normalized.experienceTypes, ["IMAX", "UltraAVX"]);
});

test("disables the next-two-hours filter for a multi-day range", () => {
  const state = makeDefaultSearchState(TODAY);
  state.endDate = "2026-08-30";
  state.filters.startsInNextTwoHours = true;

  assert.equal(getEffectiveFilters(state, TODAY).startsInNextTwoHours, false);
});

test("old URLs no longer imply the five-or-fewer filter", () => {
  const parsed = readSearchStateFromUrl(`?location=Toronto&date=${TODAY}`);

  assert.equal(parsed?.filters?.maxFiveSold, false);
});
