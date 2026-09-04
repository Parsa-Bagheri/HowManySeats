import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSearchParams,
  getEffectiveFilters,
  getSearchScopeKey,
  makeDefaultSearchState,
  normalizeSearchState,
  readSearchStateFromUrl,
} from "./search-state";

const TODAY = "2026-08-29";

test("starts with no occupancy, time, accessibility, VIP, or format filters", () => {
  const state = makeDefaultSearchState(TODAY);

  assert.equal(state.location, "");
  assert.equal(state.date, TODAY);
  assert.equal(state.endDate, "2026-08-30");
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
    experienceTypes: ["IMAX", "UltraAVX"] as const,
  };
  const parsed = readSearchStateFromUrl(
    `?${buildSearchParams({ ...original, experienceTypes: [...original.experienceTypes] })}`,
  );
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

test("replaces an invalid URL date with today's date", () => {
  const parsed = readSearchStateFromUrl("?location=Toronto&date=not-a-date");
  const normalized = normalizeSearchState(parsed ?? {}, TODAY);

  assert.equal(normalized.date, TODAY);
  assert.equal(normalized.endDate, TODAY);
});

test("search scope changes only for location, coordinates, radius, or dates", () => {
  const state = {
    ...makeDefaultSearchState(TODAY),
    latitude: 0,
    location: "  Waterloo   ON ",
    longitude: 0,
  };
  const key = getSearchScopeKey(state);

  assert.equal(
    getSearchScopeKey({
      ...state,
      experienceTypes: ["IMAX"],
      filters: { ...state.filters, onlyZeroSold: true },
      movieTitle: "Example",
      sortBy: "time-desc",
    }),
    key,
  );
  assert.equal(
    getSearchScopeKey({ ...state, location: "waterloo on" }),
    key,
  );
  assert.notEqual(getSearchScopeKey({ ...state, latitude: 1 }), key);
  assert.notEqual(getSearchScopeKey({ ...state, radiusKm: "50" }), key);
  assert.notEqual(getSearchScopeKey({ ...state, endDate: "2026-08-31" }), key);
});
