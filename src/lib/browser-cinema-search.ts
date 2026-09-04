import { LandmarkClient } from "./landmark-client";
import {
  buildSearchParams,
  getEffectiveFilters,
  type SearchState,
} from "./search-state";
import type {
  CinemaProvider,
  MovieSuggestion,
  SearchCandidate,
  SearchQuery,
} from "./types";

type BrowserCinemaSearchResult = {
  results: SearchCandidate[];
  unavailableProviders: CinemaProvider[];
};

type LandmarkBrowserClient = Pick<
  LandmarkClient,
  "search" | "suggestMovieTitles"
>;

export async function searchBrowserCinemas(
  state: SearchState,
  signal: AbortSignal,
  landmarkClient: LandmarkBrowserClient = new LandmarkClient(
    undefined,
    undefined,
    signal,
  ),
): Promise<BrowserCinemaSearchResult> {
  const params = buildSearchParams(state);
  const [cineplex, landmark] = await Promise.allSettled([
    fetchCineplexCandidates(params, signal),
    landmarkClient.search(toSearchQuery(state)),
  ]);
  throwIfAborted(signal);
  const results: SearchCandidate[] = [];
  const unavailableProviders = new Set<CinemaProvider>();
  const failures: unknown[] = [];

  if (cineplex.status === "fulfilled") {
    results.push(...cineplex.value.results);

    for (const provider of cineplex.value.unavailableProviders) {
      unavailableProviders.add(provider);
    }
  } else {
    unavailableProviders.add("cineplex");
    failures.push(cineplex.reason);
  }

  if (landmark.status === "fulfilled") {
    results.push(...landmark.value);
  } else {
    unavailableProviders.add("landmark");
    failures.push(landmark.reason);
  }

  if (unavailableProviders.size === 2) {
    throw new AggregateError(failures, "Cinema searches are unavailable.");
  }

  return {
    results: Array.from(
      new Map(results.map((result) => [result.showtime.id, result])).values(),
    ),
    unavailableProviders: Array.from(unavailableProviders),
  };
}

export async function suggestBrowserMovieTitles(
  state: SearchState,
  query: string,
  signal: AbortSignal,
  limit = 8,
  landmarkClient: LandmarkBrowserClient = new LandmarkClient(
    undefined,
    undefined,
    signal,
  ),
): Promise<MovieSuggestion[]> {
  const params = new URLSearchParams({
    location: state.location,
    date: state.date,
    endDate: state.endDate,
    radiusKm: state.radiusKm,
    query,
    limit: String(limit),
  });

  if (state.latitude !== undefined && state.longitude !== undefined) {
    params.set("latitude", String(state.latitude));
    params.set("longitude", String(state.longitude));
  }

  const [cineplex, landmark] = await Promise.allSettled([
    fetchCineplexSuggestions(params, signal),
    landmarkClient.suggestMovieTitles({
      ...toSearchQuery(state),
      movieTitle: query,
      limit,
    }),
  ]);
  throwIfAborted(signal);
  const failures: unknown[] = [];
  const suggestions: MovieSuggestion[] = [];

  if (cineplex.status === "fulfilled") {
    suggestions.push(...cineplex.value);
  } else {
    failures.push(cineplex.reason);
  }

  if (landmark.status === "fulfilled") {
    suggestions.push(...landmark.value);
  } else {
    failures.push(landmark.reason);
  }

  if (failures.length === 2) {
    throw new AggregateError(failures, "Movie suggestions are unavailable.");
  }

  return mergeMovieSuggestions(suggestions, query, limit);
}

export function mergeMovieSuggestions(
  suggestions: MovieSuggestion[],
  rawQuery: string,
  limit = 8,
): MovieSuggestion[] {
  const suggestionsByTitle = new Map<string, MovieSuggestion>();

  for (const suggestion of suggestions) {
    const key = suggestion.title.toLowerCase();
    const existing = suggestionsByTitle.get(key);

    suggestionsByTitle.set(
      key,
      existing
        ? {
            showtimeCount:
              existing.showtimeCount + suggestion.showtimeCount,
            theatreCount: existing.theatreCount + suggestion.theatreCount,
            title: existing.title,
          }
        : suggestion,
    );
  }

  return Array.from(suggestionsByTitle.values())
    .sort((a, b) => compareMovieSuggestions(a, b, rawQuery))
    .slice(0, limit);
}

async function fetchCineplexCandidates(
  params: URLSearchParams,
  signal: AbortSignal,
): Promise<BrowserCinemaSearchResult> {
  const response = await fetch(`/api/search?${params.toString()}`, { signal });
  const body = (await response.json()) as unknown;

  if (!response.ok || !isBrowserCinemaSearchResult(body)) {
    throw new Error("Cineplex search is temporarily unavailable.");
  }

  return body;
}

async function fetchCineplexSuggestions(
  params: URLSearchParams,
  signal: AbortSignal,
): Promise<MovieSuggestion[]> {
  const response = await fetch(`/api/movie-suggestions?${params.toString()}`, {
    signal,
  });
  const body = (await response.json()) as unknown;

  if (!response.ok || !hasMovieSuggestions(body)) {
    throw new Error("Cineplex movie suggestions are temporarily unavailable.");
  }

  return body.suggestions;
}

function toSearchQuery(state: SearchState): SearchQuery {
  return {
    ...getEffectiveFilters(state),
    date: state.date,
    endDate: state.endDate,
    experienceTypes: state.experienceTypes,
    latitude: state.latitude,
    location: state.location,
    longitude: state.longitude,
    movieTitle: state.movieTitle,
    radiusKm: Number(state.radiusKm),
    sortBy: state.sortBy,
  };
}

function isBrowserCinemaSearchResult(
  value: unknown,
): value is BrowserCinemaSearchResult {
  if (!isRecord(value)) {
    return false;
  }

  return (
    Array.isArray(value.results) &&
    Array.isArray(value.unavailableProviders) &&
    value.unavailableProviders.every(isCinemaProvider)
  );
}

function hasMovieSuggestions(
  value: unknown,
): value is { suggestions: MovieSuggestion[] } {
  return isRecord(value) && Array.isArray(value.suggestions);
}

function isCinemaProvider(value: unknown): value is CinemaProvider {
  return value === "cineplex" || value === "landmark";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw (
      signal.reason ??
      new DOMException("The request was aborted.", "AbortError")
    );
  }
}

function compareMovieSuggestions(
  a: MovieSuggestion,
  b: MovieSuggestion,
  rawQuery: string,
): number {
  const query = rawQuery.trim().toLowerCase();
  const aStartsWithQuery = a.title.toLowerCase().startsWith(query);
  const bStartsWithQuery = b.title.toLowerCase().startsWith(query);

  if (aStartsWithQuery !== bStartsWithQuery) {
    return aStartsWithQuery ? -1 : 1;
  }

  return (
    b.theatreCount - a.theatreCount ||
    b.showtimeCount - a.showtimeCount ||
    a.title.localeCompare(b.title)
  );
}
