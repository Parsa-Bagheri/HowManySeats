import assert from "node:assert/strict";
import test from "node:test";
import {
  CinemaSearch,
  type CinemaProviderClient,
} from "./cinema-search";
import type { SearchQuery, SearchResult } from "./types";

const query: SearchQuery = {
  date: "2026-09-01",
  endDate: "2026-09-01",
  latitude: 43.44,
  location: "Waterloo",
  longitude: -80.57,
  movieTitle: "example",
  radiusKm: 25,
};

test("keeps results from an available provider when another provider fails", async (t) => {
  const originalConsoleError = console.error;
  const result = makeResult();
  const available = providerClient({ results: [result] });
  const unavailable = providerClient({ error: new Error("Unavailable") });

  t.after(() => {
    console.error = originalConsoleError;
  });
  console.error = () => undefined;

  const search = new CinemaSearch([
    { client: unavailable, provider: "cineplex" },
    { client: available, provider: "landmark" },
  ]);

  assert.deepEqual(await search.search(query), [result]);
  assert.deepEqual(
    await search.suggestMovieTitles({ ...query, movieTitle: "example" }),
    [
      {
        showtimeCount: 1,
        theatreCount: 1,
        title: "Example Movie",
      },
    ],
  );
});

test("merges and sorts results from all available providers", async () => {
  const landmarkResult = makeResult();
  const cineplexResult: SearchResult = {
    ...landmarkResult,
    showtime: {
      ...landmarkResult.showtime,
      id: "cineplex-7402-98765",
      providerShowtimeId: "98765",
      startsAt: "2026-09-01T22:30:00.000Z",
      theatreId: "cineplex-7402",
    },
    theatre: {
      ...landmarkResult.theatre,
      id: "cineplex-7402",
      name: "Cineplex Waterloo",
      provider: "cineplex",
      providerTheatreId: "7402",
    },
  };
  const search = new CinemaSearch([
    {
      client: providerClient({ results: [cineplexResult] }),
      provider: "cineplex",
    },
    {
      client: providerClient({ results: [landmarkResult] }),
      provider: "landmark",
    },
  ]);

  const results = await search.search({ ...query, sortBy: "time-asc" });

  assert.deepEqual(
    results.map((result) => result.theatre.provider),
    ["cineplex", "landmark"],
  );
  assert.deepEqual(
    await search.suggestMovieTitles({ ...query, movieTitle: "example" }),
    [
      {
        showtimeCount: 2,
        theatreCount: 2,
        title: "Example Movie",
      },
    ],
  );
});

test("fails only when every cinema provider is unavailable", async (t) => {
  const originalConsoleError = console.error;
  const unavailable = providerClient({ error: new Error("Unavailable") });

  t.after(() => {
    console.error = originalConsoleError;
  });
  console.error = () => undefined;

  const search = new CinemaSearch([
    { client: unavailable, provider: "cineplex" },
    { client: unavailable, provider: "landmark" },
  ]);

  await assert.rejects(() => search.search(query), /Cinema searches/);
});

function providerClient({
  error,
  results = [],
}: {
  error?: Error;
  results?: SearchResult[];
}): CinemaProviderClient {
  return {
    async search() {
      if (error) {
        throw error;
      }

      return results;
    },
    async suggestMovieTitles() {
      if (error) {
        throw error;
      }

      return [
        { showtimeCount: 1, theatreCount: 1, title: "Example Movie" },
      ];
    },
  };
}

function makeResult(): SearchResult {
  return {
    distanceKm: 1.2,
    showtime: {
      format: "Regular",
      id: "landmark-200-11567088",
      movieTitle: "Example Movie",
      providerShowtimeId: "11567088",
      purchaseUrl:
        "https://www.landmarkcinemas.com/booking?cinemaId=200&filmId=1&externalSessionId=2&sessionId=11567088",
      seatPreviewUrl:
        "https://www.landmarkcinemas.com/booking?cinemaId=200&filmId=1&externalSessionId=2&sessionId=11567088",
      startsAt: "2026-09-01T23:30:00.000Z",
      theatreId: "landmark-200",
    },
    snapshot: {
      accessibilityCount: 2,
      checkedAt: "2026-09-01T18:00:00.000Z",
      occupiedEstimate: 1,
      sellableSeats: 40,
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
