import assert from "node:assert/strict";
import test from "node:test";
import {
  getResultSearchState,
  makeDefaultSearchState,
  normalizeSearchState,
  readSearchStateFromUrl,
  type SearchState,
} from "./search-state";
import { buildShareSearchUrl, copySearchLink, shareSearch } from "./share-search";

const TODAY = "2026-10-16";
const submitted: SearchState = {
  ...makeDefaultSearchState(TODAY),
  location: "Toronto, ON",
  latitude: 43.65,
  longitude: -79.38,
  movieTitle: "Example & sequel",
  experienceTypes: ["IMAX"],
  sortBy: "time-desc",
  filters: {
    ...makeDefaultSearchState(TODAY).filters,
    maxFiveSold: true,
    accessibleAvailable: true,
  },
};

test("shared links round-trip the submitted scope and result controls without unrelated URL state", () => {
  const url = new URL(buildShareSearchUrl("https://example.com/?tracking=secret#stale", submitted)!);
  assert.equal(url.origin, "https://example.com");
  assert.equal(url.pathname, "/");
  assert.equal(url.hash, "");
  assert.equal(url.searchParams.has("tracking"), false);
  assert.deepEqual(normalizeSearchState(readSearchStateFromUrl(url.search)!, TODAY), submitted);
});

test("draft location, coordinates, radius and date changes do not leak into shared results", () => {
  for (const patch of [
    { location: "Waterloo, ON" },
    { latitude: 42, longitude: -80 },
    { radiusKm: "100" },
    { date: "2026-10-17", endDate: "2026-10-18" },
  ]) {
    const draft = { ...submitted, ...patch, movieTitle: "Draft title", sortBy: "distance-asc" as const };
    const result = getResultSearchState(submitted, draft);
    assert.equal(buildShareSearchUrl("https://example.com", result), buildShareSearchUrl("https://example.com", submitted));
  }
});

test("result controls update the shared link while scope still matches the submission", () => {
  const current: SearchState = {
    ...submitted,
    movieTitle: "New title",
    experienceTypes: ["VIP"],
    sortBy: "distance-desc",
    filters: { ...submitted.filters, nonVipOnly: true, maxFiveSold: false },
  };
  const result = getResultSearchState(submitted, current);
  const url = new URL(buildShareSearchUrl("https://example.com", result)!);
  assert.deepEqual(normalizeSearchState(readSearchStateFromUrl(url.search)!, TODAY), current);
});

test("unsubmitted and invalid search scopes cannot be shared", () => {
  assert.equal(buildShareSearchUrl("https://example.com", undefined), undefined);
  for (const patch of [
    { location: " " }, { date: "invalid" }, { endDate: "2026-10-20" },
    { radiusKm: "0" }, { latitude: 91 }, { longitude: undefined },
  ]) {
    assert.equal(buildShareSearchUrl("https://example.com", { ...submitted, ...patch }), undefined);
  }
});

test("native share receives the link and does not touch the clipboard", async () => {
  const url = "https://example.com/?location=Toronto";
  let calls = 0;
  assert.equal(await shareSearch(url, {
    share: async (data) => {
      calls++;
      assert.deepEqual(data, { title: "HowManySeats search", url });
    },
    copy: async () => { assert.fail("Native share must not copy"); },
  }), "shared");
  assert.equal(calls, 1);
});

test("native share cancellation is neutral and never falls through to clipboard", async () => {
  assert.equal(await shareSearch("https://example.com", {
    share: async () => { throw new DOMException("User cancelled", "AbortError"); },
    copy: async () => { assert.fail("Cancellation must not copy"); },
  }), "cancelled");
});

test("native share failures expose manual copy without silently copying", async () => {
  for (const error of [new DOMException("Denied", "NotAllowedError"), new Error("Unavailable")]) {
    assert.equal(await shareSearch("https://example.com", {
      share: async () => { throw error; },
      copy: async () => { assert.fail("Native failure must not copy"); },
    }), "manual");
  }
});

test("without native sharing, clipboard success copies exactly the search link", async () => {
  const values: string[] = [];
  const url = "https://example.com/?location=Toronto";
  assert.equal(await shareSearch(url, { copy: async (value) => { values.push(value); } }), "copied");
  assert.deepEqual(values, [url]);
});

test("missing or rejected clipboard access exposes manual copy", async () => {
  assert.equal(await shareSearch("https://example.com", {}), "manual");
  assert.equal(await shareSearch("https://example.com", {
    copy: async () => { throw new DOMException("Denied", "NotAllowedError"); },
  }), "manual");
});

test("explicit Copy link retries clipboard independently of native sharing", async () => {
  let copied = "";
  assert.equal(await copySearchLink("https://example.com", async (url) => { copied = url; }), "copied");
  assert.equal(copied, "https://example.com");
  assert.equal(await copySearchLink("https://example.com", async () => { throw new Error("failed"); }), "manual");
});
