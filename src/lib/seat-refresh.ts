import { selectSearchCandidatesForHydration } from "./client-search-results";
import type { SearchState } from "./search-state";
import type { SearchCandidate, SearchResult } from "./types";

// Seat filters need fresh observations too: a previously crowded screening may
// now qualify. Only metadata filters can safely exclude a refresh candidate.
export function selectSeatRefreshCandidates(
  candidates: readonly SearchCandidate[],
  state: SearchState,
  authorizedIds: ReadonlySet<string>,
  now = new Date(),
  today?: string,
) {
  return selectSearchCandidatesForHydration(
    candidates,
    state,
    authorizedIds,
    authorizedIds.size,
    now,
    today,
  );
}

export function getSeatRefreshState(
  applied: SearchState,
  current: SearchState,
): SearchState {
  return {
    ...applied,
    experienceTypes: current.experienceTypes,
    filters: current.filters,
    movieTitle: current.movieTitle,
    sortBy: current.sortBy,
  };
}

export class SeatSnapshotCache {
  readonly results = new Map<string, SearchResult>();
  readonly attemptedIds = new Set<string>();
  readonly failedIds = new Set<string>();
  readonly refreshFailedIds = new Set<string>();
  controller: AbortController | undefined;

  beginRun() {
    this.controller?.abort();
    this.controller = new AbortController();
    return this.controller;
  }

  retry(candidates: readonly SearchCandidate[]) {
    for (const candidate of candidates) {
      this.attemptedIds.delete(candidate.showtime.id);
    }
  }

  reset() {
    this.results.clear();
    this.attemptedIds.clear();
    this.failedIds.clear();
    this.refreshFailedIds.clear();
  }

  // Aborted and superseded responses cannot mutate either the snapshots or the
  // attempt ledger. A later run must still be able to retry unfinished checks.
  applyBatch(
    controller: AbortController,
    candidates: readonly SearchCandidate[],
    results: readonly SearchResult[],
    refreshing: boolean,
  ): boolean {
    if (controller !== this.controller || controller.signal.aborted) return false;
    const requestedIds = new Set(
      candidates.map((candidate) => candidate.showtime.id),
    );
    const loadedIds = new Set<string>();
    for (const result of results) {
      if (!requestedIds.has(result.showtime.id)) continue;
      this.results.set(result.showtime.id, result);
      loadedIds.add(result.showtime.id);
    }
    for (const id of requestedIds) {
      this.attemptedIds.add(id);
      if (loadedIds.has(id)) {
        this.failedIds.delete(id);
        this.refreshFailedIds.delete(id);
      } else {
        this.failedIds.add(id);
        if (refreshing) this.refreshFailedIds.add(id);
      }
    }
    return true;
  }
}

export function seatSnapshotAgeMinutes(checkedAt: string, now: number): number {
  return Math.max(0, Math.floor((now - Date.parse(checkedAt)) / 60_000));
}
