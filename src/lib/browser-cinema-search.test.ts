import assert from "node:assert/strict";
import test from "node:test";
import {
  mergeMovieSuggestions,
  searchBrowserCinemas,
  suggestBrowserMovieTitles,
} from "./browser-cinema-search";
import type { SearchState } from "./search-state";
import type { SearchCandidate, SearchQuery } from "./types";

const state: SearchState = {
  date: "2026-09-05",
  endDate: "2026-09-05",
  experienceTypes: [],
  filters: {
    accessibleAvailable: false,
    maxFiveSold: false,
    nonVipOnly: false,
    onlyZeroSold: false,
    startsInNextTwoHours: false,
  },
  latitude: 43.4643,
  location: "Waterloo",
  longitude: -80.5204,
  movieTitle: "",
  radiusKm: "25",
  sortBy: "distance-asc",
};

test("combines uncapped browser Landmark and server Cineplex results", async (t) => {
  const originalFetch = globalThis.fetch;
  const cineplexResults = Array.from({ length: 41 }, (_, index) =>
    cineplexCandidate(index),
  );
  const landmarkResults = Array.from({ length: 41 }, (_, index) =>
    landmarkCandidate(index),
  );
  const landmarkClient = {
    search: async () => landmarkResults,
    suggestMovieTitles: async () => [],
  };

  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (input) => {
    const url = String(input);

    if (url.startsWith("/api/search?")) {
      return Response.json({
        partialResults: true,
        results: cineplexResults,
        unavailableProviders: [],
      });
    }

    throw new Error(`Unexpected request: ${url}`);
  };

  const result = await searchBrowserCinemas(
    state,
    new AbortController().signal,
    landmarkClient,
  );

  assert.equal(result.results.length, 82);
  assert.equal(
    result.results.filter((candidate) => candidate.theatre.provider === "landmark")
      .length,
    41,
  );
  assert.deepEqual(result.unavailableProviders, []);
  assert.equal(result.partialResults, true);

  globalThis.fetch = async (input) => {
    if (String(input).startsWith("/api/search?")) {
      throw new Error("Cineplex is unavailable.");
    }

    throw new Error(`Unexpected uncached request: ${String(input)}`);
  };

  const partialResult = await searchBrowserCinemas(
    state,
    new AbortController().signal,
    landmarkClient,
  );

  assert.equal(partialResult.results.length, 41);
  assert.deepEqual(partialResult.unavailableProviders, ["cineplex"]);
});

test("discovers an unfiltered showtime superset for local filtering", async (t) => {
  const originalFetch = globalThis.fetch;
  let cineplexUrl = "";
  let landmarkQuery: SearchQuery | undefined;
  const filteredState: SearchState = {
    ...state,
    experienceTypes: ["IMAX"],
    filters: {
      accessibleAvailable: true,
      maxFiveSold: true,
      nonVipOnly: true,
      onlyZeroSold: true,
      startsInNextTwoHours: true,
    },
    movieTitle: "Example",
    sortBy: "time-desc",
  };

  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (input) => {
    cineplexUrl = String(input);
    return Response.json({
      partialResults: false,
      results: [],
      unavailableProviders: [],
    });
  };

  await searchBrowserCinemas(
    filteredState,
    new AbortController().signal,
    {
      search: async (query) => {
        landmarkQuery = query;
        return [];
      },
      suggestMovieTitles: async () => [],
    },
  );

  const params = new URL(cineplexUrl, "https://example.com").searchParams;
  assert.equal(params.get("location"), "Waterloo");
  assert.equal(params.get("movieTitle"), null);
  assert.equal(params.get("experienceTypes"), null);
  assert.equal(params.get("accessibleAvailable"), null);
  assert.equal(params.get("nonVipOnly"), null);
  assert.equal(params.get("sortBy"), null);
  assert.equal(landmarkQuery?.movieTitle, "");
  assert.deepEqual(landmarkQuery?.experienceTypes, []);
  assert.equal(landmarkQuery?.accessibleAvailable, false);
  assert.equal(landmarkQuery?.nonVipOnly, false);
});

test("keeps Cineplex results when Landmark discovery fails", async (t) => {
  const originalFetch = globalThis.fetch;

  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (input) => {
    if (String(input).startsWith("/api/search?")) {
      return Response.json({
        partialResults: false,
        results: [cineplexCandidate(1)],
        unavailableProviders: [],
      });
    }

    throw new Error(`Unexpected request: ${String(input)}`);
  };

  const result = await searchBrowserCinemas(
    state,
    new AbortController().signal,
    {
      search: async () => {
        throw new Error("Landmark is unavailable.");
      },
      suggestMovieTitles: async () => [],
    },
  );

  assert.equal(result.results.length, 1);
  assert.deepEqual(result.unavailableProviders, ["landmark"]);
});

test("fails only when both browser providers fail", async (t) => {
  const originalFetch = globalThis.fetch;

  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async () => {
    throw new Error("Cineplex is unavailable.");
  };

  await assert.rejects(
    searchBrowserCinemas(state, new AbortController().signal, {
      search: async () => {
        throw new Error("Landmark is unavailable.");
      },
      suggestMovieTitles: async () => [],
    }),
    /Cinema searches are unavailable/,
  );
});

test("does not return partial results after a search is aborted", async (t) => {
  const originalFetch = globalThis.fetch;
  const controller = new AbortController();

  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async () =>
    Response.json({
      partialResults: false,
      results: [cineplexCandidate(1)],
      unavailableProviders: [],
    });

  const result = searchBrowserCinemas(state, controller.signal, {
    search: async () =>
      new Promise<SearchCandidate[]>((_resolve, reject) => {
        controller.signal.addEventListener(
          "abort",
          () => reject(controller.signal.reason),
          { once: true },
        );
      }),
    suggestMovieTitles: async () => [],
  });

  controller.abort();

  await assert.rejects(
    result,
    (error: unknown) =>
      error instanceof DOMException && error.name === "AbortError",
  );
});

test("merges matching movie suggestions from both providers", () => {
  assert.deepEqual(
    mergeMovieSuggestions(
      [
        { showtimeCount: 3, theatreCount: 1, title: "Example Movie" },
        { showtimeCount: 4, theatreCount: 2, title: "example movie" },
        { showtimeCount: 8, theatreCount: 1, title: "Other Movie" },
      ],
      "exa",
    ),
    [
      { showtimeCount: 7, theatreCount: 3, title: "Example Movie" },
      { showtimeCount: 8, theatreCount: 1, title: "Other Movie" },
    ],
  );
});

test("gets Landmark suggestions even when Cineplex suggestions fail", async (t) => {
  const originalFetch = globalThis.fetch;

  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (input) => {
    if (String(input).startsWith("/api/movie-suggestions?")) {
      throw new Error("Cineplex suggestions are unavailable.");
    }

    throw new Error(`Unexpected uncached request: ${String(input)}`);
  };

  const suggestions = await suggestBrowserMovieTitles(
    state,
    "example",
    new AbortController().signal,
    8,
    {
      search: async () => [],
      suggestMovieTitles: async () => [
        {
          showtimeCount: 41,
          theatreCount: 1,
          title: "Example Movie",
        },
      ],
    },
  );

  assert.deepEqual(suggestions, [
    { showtimeCount: 41, theatreCount: 1, title: "Example Movie" },
  ]);
});

function cineplexCandidate(index: number): SearchCandidate {
  return {
    distanceKm: 2,
    showtime: {
      format: "Regular",
      id: `cineplex-${index}`,
      movieTitle: "Example Movie",
      providerShowtimeId: String(2000 + index),
      seatPreviewUrl: `https://www.cineplex.com/preview/${index}`,
      startsAt: "2026-09-05T23:30:00.000Z",
      theatreId: "cineplex-1",
    },
    theatre: {
      city: "Waterloo",
      id: "cineplex-1",
      name: "Cineplex Waterloo",
      provider: "cineplex",
      providerTheatreId: "1",
      province: "ON",
    },
  };
}

function landmarkCandidate(index: number): SearchCandidate {
  return {
    distanceKm: 3,
    showtime: {
      format: "Regular, Recliner",
      id: `landmark-${index}`,
      movieTitle: "Example Movie",
      providerShowtimeId: String(3000 + index),
      purchaseUrl: `https://www.landmarkcinemas.com/booking?sessionId=${index}`,
      seatPreviewUrl: `https://www.landmarkcinemas.com/booking?sessionId=${index}`,
      startsAt: "2026-09-05T23:30:00.000Z",
      theatreId: "landmark-200",
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
