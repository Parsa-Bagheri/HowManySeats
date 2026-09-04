import { showtimeMatchesExperienceTypes } from "./experience-types";
import {
  getEffectiveFilters,
  getLocalDateInputValue,
  type SearchFilters,
  type SearchState,
} from "./search-state";
import type {
  SearchCandidate,
  SearchResult,
  SortOption,
} from "./types";

export function filterAndSortSearchResults(
  results: readonly SearchResult[],
  state: SearchState,
  now = new Date(),
  today = getLocalDateInputValue(),
): SearchResult[] {
  return sortSearchResults(
    results.filter(
      (result) =>
        matchesCandidateFilters(result, state, now, today) &&
        matchesSeatFilters(result, state.filters),
    ),
    state.sortBy,
  );
}

export function matchesCandidateFilters(
  candidate: SearchCandidate,
  state: SearchState,
  now = new Date(),
  today = getLocalDateInputValue(),
): boolean {
  const movieTitle = state.movieTitle.trim().toLowerCase();
  const filters = getEffectiveFilters(state, today);
  const startsAt = new Date(candidate.showtime.startsAt);

  if (Number.isNaN(startsAt.getTime()) || startsAt < now) {
    return false;
  }

  if (
    movieTitle &&
    !candidate.showtime.movieTitle.toLowerCase().includes(movieTitle)
  ) {
    return false;
  }

  if (filters.nonVipOnly && /vip/i.test(candidate.showtime.format)) {
    return false;
  }

  if (
    !showtimeMatchesExperienceTypes(
      candidate.showtime.format,
      state.experienceTypes,
    )
  ) {
    return false;
  }

  if (!filters.startsInNextTwoHours) {
    return true;
  }

  return startsAt.getTime() <= now.getTime() + 2 * 60 * 60 * 1000;
}

export function matchesSeatFilters(
  result: SearchResult,
  filters: SearchFilters,
): boolean {
  const openAccessibleSeats = Math.max(
    0,
    result.snapshot.accessibleSeats -
      result.snapshot.occupiedAccessibleSeats,
  );

  return (
    (!filters.onlyZeroSold || result.snapshot.occupiedEstimate === 0) &&
    (!filters.maxFiveSold || result.snapshot.occupiedEstimate <= 5) &&
    (!filters.accessibleAvailable || openAccessibleSeats > 0)
  );
}

export function sortSearchResults(
  results: readonly SearchResult[],
  sortBy: SortOption,
): SearchResult[] {
  const direction = sortBy.endsWith("desc") ? -1 : 1;

  return [...results].sort((a, b) => {
    const distance = compareOptionalDistance(
      a.distanceKm,
      b.distanceKm,
      sortBy.startsWith("distance") ? direction : 1,
    );
    const time =
      (new Date(a.showtime.startsAt).getTime() -
        new Date(b.showtime.startsAt).getTime()) *
      (sortBy.startsWith("time") ? direction : 1);

    return sortBy.startsWith("distance") ? distance || time : time || distance;
  });
}

function compareOptionalDistance(
  a: number | undefined,
  b: number | undefined,
  direction: number,
): number {
  if (a === undefined && b === undefined) {
    return 0;
  }

  if (a === undefined) {
    return 1;
  }

  if (b === undefined) {
    return -1;
  }

  return (a - b) * direction;
}
