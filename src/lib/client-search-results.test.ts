import assert from "node:assert/strict";
import test from "node:test";
import {
  filterAndSortSearchResults,
  matchesCandidateFilters,
  matchesSeatFilters,
  SEARCH_RESULT_PAGE_SIZE,
  selectSearchCandidatesForHydration,
  shouldShowSeatFailureWarning,
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

test("warns at five failures for large result sets", () => {
  assert.equal(shouldShowSeatFailureWarning(0, 270), false);
  assert.equal(shouldShowSeatFailureWarning(4, 100), false);
  assert.equal(shouldShowSeatFailureWarning(5, 100), true);
  assert.equal(shouldShowSeatFailureWarning(4, 11), false);
});

test("warns at a thirty percent failure rate for ten or fewer results", () => {
  assert.equal(shouldShowSeatFailureWarning(2, 10), false);
  assert.equal(shouldShowSeatFailureWarning(3, 10), true);
  assert.equal(shouldShowSeatFailureWarning(1, 4), false);
  assert.equal(shouldShowSeatFailureWarning(1, 3), true);
});

test("authorizes at most the 500 closest candidates for initial hydration", () => {
  const state = {
    ...makeDefaultSearchState(TODAY),
    date: TODAY,
    endDate: TODAY,
    sortBy: "distance-asc" as const,
  };
  const candidates = Array.from(
    { length: SEARCH_RESULT_PAGE_SIZE + 3 },
    (_, index) =>
      makeResult({
        distanceKm: SEARCH_RESULT_PAGE_SIZE + 3 - index,
        id: `candidate-${index}`,
      }),
  );
  const selection = selectSearchCandidatesForHydration(
    candidates,
    state,
    new Set(),
    SEARCH_RESULT_PAGE_SIZE,
    NOW,
    TODAY,
  );

  assert.equal(selection.newlyAuthorizedCandidates.length, 500);
  assert.equal(selection.remainingCount, 3);
  assert.equal(
    selection.authorizedCandidates[0]?.showtime.id,
    "candidate-502",
  );
  assert.equal(
    selection.authorizedCandidates.at(-1)?.showtime.id,
    "candidate-3",
  );

  const authorizedIds = new Set(
    selection.newlyAuthorizedCandidates.map(
      (candidate) => candidate.showtime.id,
    ),
  );
  const nextSelection = selectSearchCandidatesForHydration(
    candidates,
    state,
    authorizedIds,
    SEARCH_RESULT_PAGE_SIZE * 2,
    NOW,
    TODAY,
  );

  assert.equal(nextSelection.newlyAuthorizedCandidates.length, 3);
  assert.equal(nextSelection.authorizedCandidates.length, 503);
  assert.equal(nextSelection.remainingCount, 0);
});

test("applies the selected showtime order before authorizing a page", () => {
  const state = {
    ...makeDefaultSearchState(TODAY),
    date: TODAY,
    endDate: TODAY,
    sortBy: "time-asc" as const,
  };
  const candidates = [
    makeResult({ id: "latest", startsAt: "2026-09-04T21:00:00.000Z" }),
    makeResult({ id: "earliest", startsAt: "2026-09-04T19:00:00.000Z" }),
    makeResult({ id: "middle", startsAt: "2026-09-04T20:00:00.000Z" }),
  ];
  const selection = selectSearchCandidatesForHydration(
    candidates,
    state,
    new Set(),
    2,
    NOW,
    TODAY,
  );

  assert.deepEqual(
    selection.authorizedCandidates.map((candidate) => candidate.showtime.id),
    ["earliest", "middle"],
  );
  assert.equal(selection.remainingCount, 1);
});

test("filter and sort changes preserve the page budget until Show more", () => {
  const state = {
    ...makeDefaultSearchState(TODAY),
    date: TODAY,
    endDate: TODAY,
  };
  const candidates = Array.from({ length: 1_100 }, (_, index) =>
    makeResult({
      id: `candidate-${index}`,
      distanceKm: index + 1,
      movieTitle: index < 500 ? "First Movie" : "Second Movie",
    }),
  );
  const initial = selectSearchCandidatesForHydration(
    candidates, state, new Set(), SEARCH_RESULT_PAGE_SIZE, NOW, TODAY,
  );
  // Authorization includes failed and not-yet-finished checks, not just results.
  const authorizedIds = new Set(
    initial.newlyAuthorizedCandidates.map((candidate) => candidate.showtime.id),
  );
  const changedState = {
    ...state,
    movieTitle: "Second Movie",
    sortBy: "distance-desc" as const,
  };
  const filtered = selectSearchCandidatesForHydration(
    candidates, changedState, authorizedIds, SEARCH_RESULT_PAGE_SIZE, NOW, TODAY,
  );
  assert.equal(filtered.authorizedCandidates.length, 0);
  assert.equal(filtered.newlyAuthorizedCandidates.length, 0);
  assert.equal(filtered.remainingCount, 600);

  const nextPage = selectSearchCandidatesForHydration(
    candidates, changedState, authorizedIds, SEARCH_RESULT_PAGE_SIZE * 2, NOW, TODAY,
  );
  assert.equal(nextPage.newlyAuthorizedCandidates.length, 500);
  assert.equal(nextPage.authorizedCandidates[0]?.showtime.id, "candidate-1099");
  assert.equal(nextPage.authorizedCandidates.at(-1)?.showtime.id, "candidate-600");
  assert.equal(nextPage.remainingCount, 100);
  for (const candidate of nextPage.newlyAuthorizedCandidates) {
    authorizedIds.add(candidate.showtime.id);
  }
  const cleared = selectSearchCandidatesForHydration(
    candidates, state, authorizedIds, SEARCH_RESULT_PAGE_SIZE * 2, NOW, TODAY,
  );
  assert.equal(cleared.authorizedCandidates.length, 1_000);
  assert.equal(cleared.newlyAuthorizedCandidates.length, 0);
  assert.equal(cleared.remainingCount, 100);
});

function makeResult(
  overrides: {
    accessibleSeats?: number;
    companionSeats?: number;
    distanceKm?: number;
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
    distanceKm: overrides.distanceKm ?? (id === "later" ? 2 : 1),
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
