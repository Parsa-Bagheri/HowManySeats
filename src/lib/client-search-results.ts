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

const MIN_SIGNIFICANT_SEAT_FAILURES = 5;
const SMALL_RESULT_SET_MAX = 10;
const SMALL_RESULT_SET_FAILURE_RATIO = 0.3;

export const SEARCH_RESULT_PAGE_SIZE = 500;

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

export function shouldShowSeatFailureWarning(
  failedCount: number,
  totalCount: number,
): boolean {
  if (failedCount <= 0 || totalCount <= 0) {
    return false;
  }

  if (totalCount <= SMALL_RESULT_SET_MAX) {
    return failedCount / totalCount >= SMALL_RESULT_SET_FAILURE_RATIO;
  }

  return failedCount >= MIN_SIGNIFICANT_SEAT_FAILURES;
}

export function selectSearchCandidatesForHydration(
  candidates: readonly SearchCandidate[],
  state: SearchState,
  authorizedIds: ReadonlySet<string>,
  authorizationLimit: number,
  now = new Date(),
  today = getLocalDateInputValue(),
): {
  authorizedCandidates: SearchCandidate[];
  newlyAuthorizedCandidates: SearchCandidate[];
  remainingCount: number;
} {
  const eligibleCandidates = sortSearchCandidates(
    candidates.filter((candidate) =>
      matchesCandidateFilters(candidate, state, now, today),
    ),
    state.sortBy,
  );
  const availableAuthorizationSlots = Math.max(
    0,
    Math.floor(authorizationLimit) - authorizedIds.size,
  );
  const newlyAuthorizedCandidates = eligibleCandidates
    .filter((candidate) => !authorizedIds.has(candidate.showtime.id))
    .slice(0, availableAuthorizationSlots);
  const nextAuthorizedIds = new Set(authorizedIds);

  for (const candidate of newlyAuthorizedCandidates) {
    nextAuthorizedIds.add(candidate.showtime.id);
  }

  const authorizedCandidates = eligibleCandidates.filter((candidate) =>
    nextAuthorizedIds.has(candidate.showtime.id),
  );

  return {
    authorizedCandidates,
    newlyAuthorizedCandidates,
    remainingCount: eligibleCandidates.length - authorizedCandidates.length,
  };
}

export function sortSearchResults(
  results: readonly SearchResult[],
  sortBy: SortOption,
): SearchResult[] {
  return sortSearchCandidates(results, sortBy);
}

export function sortSearchCandidates<T extends SearchCandidate>(
  candidates: readonly T[],
  sortBy: SortOption,
): T[] {
  const direction = sortBy.endsWith("desc") ? -1 : 1;

  return [...candidates].sort((a, b) => {
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
