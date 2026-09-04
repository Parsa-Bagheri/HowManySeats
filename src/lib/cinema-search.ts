import { CineplexClient } from "./cineplex-client";
import { LandmarkClient } from "./landmark-client";
import type {
  CinemaProvider,
  MovieSuggestion,
  MovieSuggestionQuery,
  SearchCandidate,
  SearchQuery,
  SortOption,
} from "./types";

export type CinemaProviderClient = {
  search(query: SearchQuery): Promise<SearchCandidate[]>;
  suggestMovieTitles(query: MovieSuggestionQuery): Promise<MovieSuggestion[]>;
  wasLastSearchPartial?(): boolean;
};

export type ProviderEntry = {
  client: CinemaProviderClient;
  provider: CinemaProvider;
};

export type CinemaSearchResult = {
  partialResults: boolean;
  results: SearchCandidate[];
  unavailableProviders: CinemaProvider[];
};

export class CinemaSearch {
  private readonly providers: readonly ProviderEntry[];

  constructor(
    providers: readonly ProviderEntry[] = [
      { client: new CineplexClient(), provider: "cineplex" },
      { client: new LandmarkClient(), provider: "landmark" },
    ],
  ) {
    this.providers = providers;
  }

  async search(query: SearchQuery): Promise<CinemaSearchResult> {
    const settled = await Promise.allSettled(
      this.providers.map(({ client }) => client.search(query)),
    );
    const results: SearchCandidate[] = [];
    const failures: unknown[] = [];
    let partialResults = false;
    const unavailableProviders: CinemaProvider[] = [];

    settled.forEach((result, index) => {
      if (result.status === "fulfilled") {
        results.push(...result.value);
        partialResults ||=
          this.providers[index]?.client.wasLastSearchPartial?.() ?? false;
        return;
      }

      const provider = this.providers[index]?.provider;
      console.error(`${provider ?? "unknown"} search failed`, result.reason);
      failures.push(result.reason);

      if (provider) {
        unavailableProviders.push(provider);
      }
    });

    if (settled.length > 0 && failures.length === settled.length) {
      throw new AggregateError(failures, "Cinema searches are unavailable.");
    }

    const deduped = Array.from(
      new Map(results.map((result) => [result.showtime.id, result])).values(),
    );
    return {
      partialResults,
      results: sortResults(deduped, query.sortBy ?? "distance-asc"),
      unavailableProviders,
    };
  }

  async suggestMovieTitles(
    query: MovieSuggestionQuery,
  ): Promise<MovieSuggestion[]> {
    const settled = await Promise.allSettled(
      this.providers.map(({ client }) => client.suggestMovieTitles(query)),
    );
    const failures: unknown[] = [];
    const suggestions = new Map<string, MovieSuggestion>();

    settled.forEach((result, index) => {
      if (result.status === "rejected") {
        const provider = this.providers[index]?.provider ?? "unknown";
        console.error(`${provider} movie suggestions failed`, result.reason);
        failures.push(result.reason);
        return;
      }

      for (const suggestion of result.value) {
        const key = suggestion.title.toLowerCase();
        const existing = suggestions.get(key);

        suggestions.set(
          key,
          existing
            ? {
                showtimeCount:
                  existing.showtimeCount + suggestion.showtimeCount,
                theatreCount:
                  existing.theatreCount + suggestion.theatreCount,
                title: existing.title,
              }
            : suggestion,
        );
      }
    });

    if (settled.length > 0 && failures.length === settled.length) {
      throw new AggregateError(
        failures,
        "Movie suggestions are unavailable.",
      );
    }

    return Array.from(suggestions.values())
      .sort((a, b) => compareMovieSuggestions(a, b, query.movieTitle))
      .slice(0, query.limit ?? 8);
  }
}

function sortResults(
  results: SearchCandidate[],
  sortBy: SortOption,
): SearchCandidate[] {
  return results.sort((a, b) => {
    const direction = sortBy.endsWith("desc") ? -1 : 1;
    const primary = sortBy.startsWith("distance")
      ? compareOptionalNumber(a.distanceKm, b.distanceKm, direction)
      : compareTimeValues(a.showtime.startsAt, b.showtime.startsAt, direction);
    const secondary = sortBy.startsWith("distance")
      ? compareTimeValues(a.showtime.startsAt, b.showtime.startsAt, 1)
      : compareOptionalNumber(a.distanceKm, b.distanceKm, 1);

    return (
      primary ||
      secondary ||
      a.theatre.provider.localeCompare(b.theatre.provider)
    );
  });
}

function compareTimeValues(a: string, b: string, direction: number): number {
  return (new Date(a).getTime() - new Date(b).getTime()) * direction;
}

function compareOptionalNumber(
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

function compareMovieSuggestions(
  a: MovieSuggestion,
  b: MovieSuggestion,
  rawQuery: string,
): number {
  const query = rawQuery.trim().toLowerCase();
  const aTitle = a.title.toLowerCase();
  const bTitle = b.title.toLowerCase();
  const aStartsWithQuery = query.length > 0 && aTitle.startsWith(query);
  const bStartsWithQuery = query.length > 0 && bTitle.startsWith(query);

  if (aStartsWithQuery !== bStartsWithQuery) {
    return aStartsWithQuery ? -1 : 1;
  }

  return (
    b.theatreCount - a.theatreCount ||
    b.showtimeCount - a.showtimeCount ||
    a.title.localeCompare(b.title)
  );
}
