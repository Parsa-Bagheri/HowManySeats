import assert from "node:assert/strict";
import test from "node:test";
import { CineplexClient } from "../cineplex-client";
import { cineplexCollector } from "./collector";
import { fixtureScreening } from "./fixtures";
import { CollectionError } from "./model";

test("collector handles provider-shaped maps with separate unknown/excluded/accessibility counts", async (t) => {
  const previous = globalThis.fetch; t.after(() => { globalThis.fetch = previous; });
  globalThis.fetch = async (input) => new Response(JSON.stringify(String(input).includes("seat-layout") ? {
    standardSeats: { rows: [{ seats: [{ id: "s1", type: "Standard" }, { id: "s2", type: "Wheelchair" }, { id: "s3", type: "Companion" }, { id: "s4" }, { id: "s5" }] }] },
  } : { seatAvailabilities: { s1: "Available", s2: "Occupied", s3: "Available", s4: "Mystery", s5: "Broken" } }));
  const result = await cineplexCollector(fixtureScreening());
  assert.equal(result.sellableSeats, 1); assert.equal(result.accessibleSeats, 1); assert.equal(result.occupiedAccessibleSeats, 1); assert.equal(result.companionSeats, 1); assert.equal(result.unknownSeats, 1); assert.equal(result.excludedSeats, 1); assert.equal(result.partial, true);
});
test("collector distinguishes timeout, rate limiting, malformed payload and unavailable screening", async (t) => {
  const previous = globalThis.fetch; t.after(() => { globalThis.fetch = previous; });
  for (const [fetcher, code, retryable] of [
    [async () => { throw new DOMException("Operation aborted", "AbortError"); }, "timeout", true],
    [async () => new Response("rate limited", { status: 429 }), "rate-limited", true],
    [async () => new Response("{broken"), "malformed", false],
    [async () => new Response("{}"), "malformed", false],
    [async () => new Response("gone", { status: 404 }), "screening-unavailable", false],
  ] as const) {
    globalThis.fetch = fetcher;
    await assert.rejects(cineplexCollector(fixtureScreening()), (error: unknown) => error instanceof CollectionError && error.code === code && error.retryable === retryable);
  }
});
test("Cineplex resolves canonical theatre/timezone/title/start from directory and showtime identifiers", async (t) => {
  const previous = globalThis.fetch; t.after(() => { globalThis.fetch = previous; });
  globalThis.fetch = async (input) => new Response(JSON.stringify(String(input).includes("/theatres?") ? { otherTheatres: [{ theatreId: 7402, theatreName: "Provider Cinema", location: { city: "Waterloo", provinceCode: "ON", geoLocation: { latitude: 43.46, longitude: -80.52 } } }] } : [{ dates: [{ movies: [{ name: "Provider Title", experiences: [{ sessions: [{ vistaSessionId: 123, showStartDateTime: "2026-10-14T19:00:00", isReservedSeating: true }] }] }] }] }]));
  const result = await new CineplexClient(undefined, () => new Date("2026-10-13T18:00:00Z")).resolveScreening("7402", "123");
  assert.equal(result?.theatre.name, "Provider Cinema"); assert.equal(result?.showtime.movieTitle, "Provider Title"); assert.equal(result?.theatre.timeZone, "America/Toronto"); assert.equal(result?.showtime.startsAt, "2026-10-14T23:00:00.000Z");
  assert.equal(await new CineplexClient().resolveScreening("9999", "123"), undefined);
});
