import assert from "node:assert/strict";
import test from "node:test";
import {
  filterAndSortSearchResults,
  matchesCandidateFilters,
  matchesSeatFilters,
} from "./client-search-results";
import { makeDefaultSearchState } from "./search-state";
import type { SearchResult } from "./types";

const TODAY = "2026-09-04";
const NOW = new Date("2026-09-04T18:00:00.000Z");

test("applies movie, experience, VIP, and time filters without another search", () => {
  const state = {
    ...makeDefaultSearchState(TODAY),
    date: TODAY,
    endDate: TODAY,
    experienceTypes: ["IMAX" as const],
    filters: {
      ...makeDefaultSearchState(TODAY).filters,
      nonVipOnly: true,
      startsInNextTwoHours: true,
    },
    movieTitle: "example",
  };

  assert.equal(
    matchesCandidateFilters(
      makeResult({ format: "IMAX", startsAt: "2026-09-04T19:30:00.000Z" }),
      state,
      NOW,
      TODAY,
    ),
    true,
  );
  assert.equal(
    matchesCandidateFilters(
      makeResult({ format: "VIP, IMAX", startsAt: "2026-09-04T19:30:00.000Z" }),
      state,
      NOW,
      TODAY,
    ),
    false,
  );
  assert.equal(
    matchesCandidateFilters(
      makeResult({ format: "IMAX", startsAt: "2026-09-04T21:00:00.000Z" }),
      state,
      NOW,
      TODAY,
    ),
    false,
  );
});

test("keeps accessibility and companion occupancy out of standard occupancy filters", () => {
  const result = makeResult({
    accessibleSeats: 2,
    companionSeats: 2,
    occupiedAccessibleSeats: 2,
    occupiedCompanionSeats: 2,
    occupiedEstimate: 0,
  });

  assert.equal(
    matchesSeatFilters(result, {
      accessibleAvailable: false,
      maxFiveSold: false,
      nonVipOnly: false,
      onlyZeroSold: true,
      startsInNextTwoHours: false,
    }),
    true,
  );
});

test("requires an open wheelchair space for the accessibility filter", () => {
  const filters = {
    accessibleAvailable: true,
    maxFiveSold: false,
    nonVipOnly: false,
    onlyZeroSold: false,
    startsInNextTwoHours: false,
  };

  assert.equal(
    matchesSeatFilters(
      makeResult({ accessibleSeats: 2, occupiedAccessibleSeats: 1 }),
      filters,
    ),
    true,
  );
  assert.equal(
    matchesSeatFilters(
      makeResult({ accessibleSeats: 2, occupiedAccessibleSeats: 2 }),
      filters,
    ),
    false,
  );
  assert.equal(
    matchesSeatFilters(
      makeResult({
        accessibleSeats: 0,
        companionSeats: 2,
        occupiedCompanionSeats: 0,
      }),
      filters,
    ),
    false,
  );
});

test("filters and re-sorts cached results locally", () => {
  const state = {
    ...makeDefaultSearchState(TODAY),
    date: TODAY,
    endDate: TODAY,
    movieTitle: "example",
    sortBy: "time-desc" as const,
  };
  const earlier = makeResult({
    id: "earlier",
    startsAt: "2026-09-04T19:00:00.000Z",
  });
  const later = makeResult({
    id: "later",
    startsAt: "2026-09-04T20:00:00.000Z",
  });
  const unrelated = makeResult({ id: "other", movieTitle: "Other Movie" });

  assert.deepEqual(
    filterAndSortSearchResults(
      [earlier, unrelated, later],
      state,
      NOW,
      TODAY,
    ).map((result) => result.showtime.id),
    ["later", "earlier"],
  );
});

test("clearing filters restores cached results", () => {
  const filteredState = {
    ...makeDefaultSearchState(TODAY),
    date: TODAY,
    endDate: TODAY,
    experienceTypes: ["IMAX" as const],
  };
  const regular = makeResult({ format: "Regular", id: "regular" });
  const imax = makeResult({ format: "IMAX", id: "imax" });

  assert.deepEqual(
    filterAndSortSearchResults(
      [regular, imax],
      filteredState,
      NOW,
      TODAY,
    ).map((result) => result.showtime.id),
    ["imax"],
  );
  assert.deepEqual(
    filterAndSortSearchResults(
      [regular, imax],
      { ...filteredState, experienceTypes: [] },
      NOW,
      TODAY,
    ).map((result) => result.showtime.id),
    ["regular", "imax"],
  );
});

test("does not apply the two-hour filter to a multi-day search", () => {
  const state = makeDefaultSearchState(TODAY);
  state.date = TODAY;
  state.endDate = "2026-09-05";
  state.filters.startsInNextTwoHours = true;

  assert.equal(
    matchesCandidateFilters(
      makeResult({ startsAt: "2026-09-05T20:00:00.000Z" }),
      state,
      NOW,
      TODAY,
    ),
    true,
  );
});

function makeResult(
  overrides: {
    accessibleSeats?: number;
    companionSeats?: number;
    format?: string;
    id?: string;
    movieTitle?: string;
    occupiedAccessibleSeats?: number;
    occupiedCompanionSeats?: number;
    occupiedEstimate?: number;
    startsAt?: string;
  } = {},
): SearchResult {
  const id = overrides.id ?? "example";

  return {
    distanceKm: id === "later" ? 2 : 1,
    showtime: {
      format: overrides.format ?? "Regular",
      id,
      movieTitle: overrides.movieTitle ?? "Example Movie",
      providerShowtimeId: id,
      seatPreviewUrl: `https://example.com/${id}`,
      startsAt: overrides.startsAt ?? "2026-09-04T19:00:00.000Z",
      theatreId: "landmark-200",
    },
    snapshot: {
      accessibilityCount:
        (overrides.accessibleSeats ?? 0) + (overrides.companionSeats ?? 0),
      accessibleSeats: overrides.accessibleSeats ?? 0,
      checkedAt: "2026-09-04T18:00:00.000Z",
      companionSeats: overrides.companionSeats ?? 0,
      occupiedAccessibleSeats: overrides.occupiedAccessibleSeats ?? 0,
      occupiedCompanionSeats: overrides.occupiedCompanionSeats ?? 0,
      occupiedEstimate: overrides.occupiedEstimate ?? 0,
      sellableSeats: 20,
    },
    theatre: {
      city: "Waterloo",
      id: "landmark-200",
      name: "Waterloo",
      provider: "landmark",
      providerTheatreId: "200",
      province: "ON",
    },
  };
}
