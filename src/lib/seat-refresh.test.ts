import assert from "node:assert/strict";
import test from "node:test";
import { filterAndSortSearchResults, selectSearchCandidatesForHydration } from "./client-search-results";
import { getSeatRefreshState, SeatSnapshotCache, seatSnapshotAgeMinutes, selectSeatRefreshCandidates } from "./seat-refresh";
import { makeDefaultSearchState } from "./search-state";
import type { SearchResult } from "./types";

const TODAY = "2026-09-04";
const NOW = new Date(`${TODAY}T18:00:00Z`);
const state = makeDefaultSearchState(TODAY);

function result(id: number, occupiedEstimate = 0, checkedAt = NOW.toISOString()): SearchResult {
  const provider = id % 2 ? "cineplex" : "landmark";
  return {
    distanceKm: id,
    theatre: { id: `${provider}-1`, provider, providerTheatreId: "1", name: "Cinema", city: "Waterloo", province: "ON" },
    showtime: { id: `${provider}-${id}`, providerShowtimeId: String(id), theatreId: `${provider}-1`, movieTitle: "Example Movie", format: "Regular", startsAt: `${TODAY}T19:00:00Z`, seatPreviewUrl: "https://example.com" },
    snapshot: { checkedAt, occupiedEstimate, sellableSeats: 20, accessibleSeats: 2, occupiedAccessibleSeats: 0, companionSeats: 2, occupiedCompanionSeats: 1, accessibilityCount: 4 },
  };
}

test("refresh retries both providers and failed attempts while retaining old snapshots until success", () => {
  const cache = new SeatSnapshotCache();
  const candidates = [result(1), result(2), result(3)];
  const initial = cache.beginRun();
  cache.applyBatch(initial, candidates, candidates.slice(0, 2), false);
  assert.equal(cache.failedIds.has(candidates[2].showtime.id), true);
  const refresh = cache.beginRun();
  cache.retry(candidates);
  assert.equal(cache.attemptedIds.size, 0);
  assert.equal(cache.results.size, 2);
  const updated = candidates.map((item) => ({ ...item, snapshot: { ...item.snapshot, checkedAt: `${TODAY}T18:02:00Z`, occupiedEstimate: 4 } }));
  cache.applyBatch(refresh, candidates, updated, true);
  assert.equal(cache.results.size, 3);
  assert.equal(cache.failedIds.size, 0);
  assert.equal(cache.attemptedIds.size, 3);
  assert.equal(cache.results.get(candidates[0].showtime.id)?.snapshot.occupiedEstimate, 4);
});

test("one failed refresh preserves its exact successful snapshot and reports partial even after later cache reuse", () => {
  const cache = new SeatSnapshotCache();
  const old = result(1);
  cache.applyBatch(cache.beginRun(), [old], [old], false);
  const refresh = cache.beginRun();
  cache.retry([old]);
  cache.applyBatch(refresh, [old], [], true);
  assert.equal(cache.results.get(old.showtime.id), old);
  assert.equal(cache.results.get(old.showtime.id)?.snapshot.checkedAt, NOW.toISOString());
  assert.equal(cache.refreshFailedIds.has(old.showtime.id), true);
  cache.beginRun();
  assert.equal(cache.refreshFailedIds.has(old.showtime.id), true);
  cache.retry([old]);
  cache.applyBatch(cache.controller!, [old], [result(1, 2, `${TODAY}T18:05:00Z`)], true);
  assert.equal(cache.refreshFailedIds.size, 0);
});

test("refresh cannot authorize another showtime even with unused slots or changed filters", () => {
  const candidates = Array.from({ length: 1_100 }, (_, i) => result(i + 1));
  const initial = selectSearchCandidatesForHydration(candidates, state, new Set(), 500, NOW, TODAY);
  const authorized = new Set(initial.authorizedCandidates.map((item) => item.showtime.id));
  const refreshed = selectSeatRefreshCandidates(candidates, state, authorized, NOW, TODAY);
  assert.equal(refreshed.authorizedCandidates.length, 500);
  assert.equal(refreshed.newlyAuthorizedCandidates.length, 0);
  assert.equal(refreshed.remainingCount, 600);
  const sparse = selectSeatRefreshCandidates(candidates, state, new Set([candidates[0].showtime.id]), NOW, TODAY);
  assert.equal(sparse.authorizedCandidates.length, 1);
  assert.equal(sparse.newlyAuthorizedCandidates.length, 0);
  // Only explicit Show more increases the existing window.
  const next = selectSearchCandidatesForHydration(candidates, state, authorized, 1_000, NOW, TODAY);
  next.newlyAuthorizedCandidates.forEach((item) => authorized.add(item.showtime.id));
  assert.equal(selectSeatRefreshCandidates(candidates, state, authorized, NOW, TODAY).authorizedCandidates.length, 1_000);
});

test("refresh respects current metadata filters and rechecks old snapshots excluded by seat filters", () => {
  const crowded = result(1, 15);
  const other = { ...result(2), showtime: { ...result(2).showtime, movieTitle: "Other" } };
  const expired = { ...result(3), showtime: { ...result(3).showtime, startsAt: `${TODAY}T17:00:00Z` } };
  const filtered = { ...state, movieTitle: "Example", filters: { ...state.filters, onlyZeroSold: true, accessibleAvailable: true } };
  assert.equal(filterAndSortSearchResults([crowded], filtered, NOW, TODAY).length, 0);
  const selection = selectSeatRefreshCandidates([crowded, other, expired], filtered, new Set([crowded.showtime.id, other.showtime.id, expired.showtime.id]), NOW, TODAY);
  assert.deepEqual(selection.authorizedCandidates, [crowded]);
});

test("refresh keeps submitted location, coordinates, dates and radius while taking current result filters", () => {
  const applied = { ...state, location: "Waterloo", latitude: 43, longitude: -80 };
  const staged = { ...state, location: "Toronto", latitude: 44, longitude: -79, date: "2026-09-07", endDate: "2026-09-08", radiusKm: "100", movieTitle: "Example", filters: { ...state.filters, maxFiveSold: true }, experienceTypes: ["IMAX" as const], sortBy: "time-desc" as const };
  const refreshed = getSeatRefreshState(applied, staged);
  assert.deepEqual({ ...refreshed, movieTitle: applied.movieTitle, filters: applied.filters, experienceTypes: applied.experienceTypes, sortBy: applied.sortBy }, applied);
  assert.equal(refreshed.filters, staged.filters);
  assert.equal(refreshed.movieTitle, staged.movieTitle);
  assert.equal(refreshed.sortBy, staged.sortBy);
  assert.equal(refreshed.experienceTypes, staged.experienceTypes);
});

test("a delayed aborted response cannot replace a newer observation or poison retries", async () => {
  const cache = new SeatSnapshotCache();
  const old = result(1);
  const oldController = cache.beginRun();
  let finish!: () => void;
  const delayed = new Promise<void>((resolve) => { finish = resolve; }).then(() => cache.applyBatch(oldController, [old], [old], true));
  const newController = cache.beginRun();
  assert.equal(oldController.signal.aborted, true);
  const newer = result(1, 7, `${TODAY}T18:05:00Z`);
  cache.applyBatch(newController, [newer], [newer], true);
  finish();
  assert.equal(await delayed, false);
  assert.equal(cache.results.get(old.showtime.id), newer);
  cache.reset();
  cache.beginRun();
  assert.equal(cache.applyBatch(newController, [newer], [], true), false);
  assert.equal(cache.results.size, 0);
  assert.equal(cache.attemptedIds.size, 0);
  assert.equal(cache.failedIds.size, 0);
});

test("an aborted unfinished batch stays retryable, and unexpected response IDs are ignored", () => {
  const cache = new SeatSnapshotCache();
  const controller = cache.beginRun();
  controller.abort();
  assert.equal(cache.applyBatch(controller, [result(1)], [result(1)], false), false);
  assert.equal(cache.attemptedIds.size, 0);
  cache.applyBatch(cache.beginRun(), [result(1)], [result(2)], false);
  assert.equal(cache.results.size, 0);
  assert.equal(cache.failedIds.has(result(1).showtime.id), true);
});

test("freshness advances with idle clock ticks and never rounds a recent check up", () => {
  const checkedAt = NOW.toISOString();
  assert.equal(seatSnapshotAgeMinutes(checkedAt, NOW.getTime()), 0);
  assert.equal(seatSnapshotAgeMinutes(checkedAt, NOW.getTime() + 59_999), 0);
  assert.equal(seatSnapshotAgeMinutes(checkedAt, NOW.getTime() + 60_000), 1);
  assert.equal(seatSnapshotAgeMinutes(checkedAt, NOW.getTime() + 180_000), 3);
  assert.equal(seatSnapshotAgeMinutes(checkedAt, NOW.getTime() - 5_000), 0);
});
