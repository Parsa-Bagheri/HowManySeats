import { getSearchDates } from "./date-range";
import {
  distanceKm,
  getProvinceCode,
  resolveLocation,
  type Coordinates,
} from "./geo";
import { showtimeMatchesExperienceTypes } from "./experience-types";
import {
  getLandmarkTheatre,
  LANDMARK_THEATRES,
  type LandmarkTheatre,
} from "./landmark-theatres";
import { localDateTimeToIso } from "./showtime-time";
import type {
  MovieSuggestion,
  MovieSuggestionQuery,
  SearchCandidate,
  SearchQuery,
  Showtime,
  SortOption,
  Theatre,
} from "./types";

const LANDMARK_PUBLIC_ORIGIN = "https://www.landmarkcinemas.com";
const LANDMARK_MOVIE_API_ORIGIN = "https://movieapi.landmarkcinemas.com";
const LANDMARK_CIRCUIT_ID = "22";
const DEFAULT_MOVIE_CACHE_SECONDS = 60;
const MAX_MOVIE_CACHE_SECONDS = 300;
const MAX_MOVIE_CACHE_ENTRIES = 16;
const MAX_SUGGESTION_THEATRES = 8;
const SOURCE_TIMEOUT_MS = 15_000;

type LandmarkExperience = {
  Description?: string;
  ExternalId?: string;
  Name?: string;
};

type LandmarkShowtimeTime = {
  CinemaId?: number | string;
  CinemaName?: string;
  Experience?: LandmarkExperience[];
  ExternalSessionId?: number | string;
  Scheduleid?: number | string;
  Screen?: string;
  SessionExpired?: boolean;
  SoldOut?: boolean;
  StartTime?: string;
};

type LandmarkExperienceGroup = {
  ExperienceAttributes?: Array<{
    Description?: string;
    Name?: string;
  }>;
  Times?: LandmarkShowtimeTime[];
};

type LandmarkSession = {
  ExperienceTypes?: LandmarkExperienceGroup[];
  NewDate?: string;
  Times?: LandmarkShowtimeTime[];
};

export type LandmarkMovie = {
  FilmId?: number | string;
  Sessions?: LandmarkSession[];
  Title?: string;
};

type CachedLandmarkMovies = {
  expiresAt: number;
  value: Promise<LandmarkMovie[]>;
};

const sharedMovieCache = new Map<string, CachedLandmarkMovies>();

type ShowtimeCandidate = {
  distanceKm?: number;
  showtime: Showtime;
  theatre: LandmarkTheatre;
};

export class LandmarkClient {
  private readonly requestMovieCache = new Map<
    string,
    Promise<LandmarkMovie[]>
  >();
  private readonly movieApiOrigin: string;
  private readonly now: () => Date;

  constructor(
    movieApiOrigin = LANDMARK_MOVIE_API_ORIGIN,
    now: () => Date = () => new Date(),
  ) {
    this.movieApiOrigin = movieApiOrigin.replace(/\/$/, "");
    this.now = now;
  }

  async search(query: SearchQuery): Promise<SearchCandidate[]> {
    return this.performSearch(query);
  }

  private async performSearch(query: SearchQuery): Promise<SearchCandidate[]> {
    const searchStartedAt = this.now();
    const { origin, theatres } = await this.resolveSearchArea(query);
    const searchDates = getValidatedSearchDates(query);
    const maxTheatres = readPositiveInteger(
      process.env.LANDMARK_MAX_THEATRES_PER_SEARCH,
      5,
      LANDMARK_THEATRES.length,
    );
    const sortBy = query.sortBy ?? "distance-asc";
    const candidateGroups: ShowtimeCandidate[][] = searchDates.map(() => []);
    const selectedTheatres = theatres.slice(0, maxTheatres);
    const showtimeSettled = await Promise.allSettled(
      selectedTheatres.map(async (theatre) => ({
        showtimesByDate: await Promise.all(
          searchDates.map((date) => this.getShowtimes(theatre, date)),
        ),
        theatre,
      })),
    );

    if (
      selectedTheatres.length > 0 &&
      showtimeSettled.every((result) => result.status === "rejected")
    ) {
      throw new AggregateError(
        showtimeSettled
          .filter((result) => result.status === "rejected")
          .map((result) => result.reason),
        "Landmark showtimes are unavailable.",
      );
    }

    for (const settled of showtimeSettled) {
      if (settled.status === "rejected") {
        console.error("Landmark theatre request failed", settled.reason);
        continue;
      }

      const { theatre, showtimesByDate } = settled.value;

      for (const [dateIndex, showtimes] of showtimesByDate.entries()) {
        for (const showtime of filterShowtimes(
          showtimes,
          query,
          searchStartedAt,
        )) {
          candidateGroups[dateIndex].push({
            distanceKm: getDistanceFromOrigin(origin, theatre),
            showtime,
            theatre,
          });
        }
      }
    }

    const candidates = Array.from(
      new Map(
        interleaveCandidates(
          candidateGroups.map((group) =>
            sortShowtimeCandidates(group, sortBy),
          ),
        ).map((candidate) => [candidate.showtime.id, candidate]),
      ).values(),
    );
    return sortResults(candidates, sortBy);
  }

  async suggestMovieTitles(
    query: MovieSuggestionQuery,
  ): Promise<MovieSuggestion[]> {
    return this.performSuggestMovieTitles(query);
  }

  private async performSuggestMovieTitles(
    query: MovieSuggestionQuery,
  ): Promise<MovieSuggestion[]> {
    const suggestionStartedAt = this.now();
    const terms = normalizeSuggestionTerms(query.movieTitle);

    if (!terms.length) {
      return [];
    }

    const theatres = (await this.resolveSearchArea(query)).theatres.slice(
      0,
      MAX_SUGGESTION_THEATRES,
    );
    const searchDates = getValidatedSearchDates(query);
    const settledGroups = await Promise.allSettled(
      theatres.map(async (theatre) => ({
        showtimes: dedupeShowtimes(
          (
            await Promise.all(
              searchDates.map((date) => this.getShowtimes(theatre, date)),
            )
          ).flat(),
        ),
        theatre,
      })),
    );
    const suggestionsByTitle = new Map<
      string,
      { title: string; theatreIds: Set<string>; showtimeCount: number }
    >();

    for (const settled of settledGroups) {
      if (settled.status === "rejected") {
        continue;
      }

      const { showtimes, theatre } = settled.value;

      for (const showtime of showtimes) {
        if (isPastShowtime(showtime, suggestionStartedAt)) {
          continue;
        }

        if (!matchesMovieTitle(showtime.movieTitle, terms)) {
          continue;
        }

        const key = showtime.movieTitle.toLowerCase();
        const suggestion = suggestionsByTitle.get(key) ?? {
          showtimeCount: 0,
          theatreIds: new Set<string>(),
          title: showtime.movieTitle,
        };

        suggestion.showtimeCount += 1;
        suggestion.theatreIds.add(theatre.id);
        suggestionsByTitle.set(key, suggestion);
      }
    }

    return Array.from(suggestionsByTitle.values())
      .map((suggestion) => ({
        showtimeCount: suggestion.showtimeCount,
        theatreCount: suggestion.theatreIds.size,
        title: suggestion.title,
      }))
      .sort((a, b) => compareMovieSuggestions(a, b, query.movieTitle))
      .slice(0, query.limit ?? 8);
  }

  async getShowtimes(theatre: Theatre, date: string): Promise<Showtime[]> {
    const landmarkTheatre = requireLandmarkTheatre(theatre);
    const movies = await this.getTheatreMovies(landmarkTheatre);
    const showtimes: Showtime[] = [];

    for (const movie of movies) {
      const filmId = toId(movie.FilmId);
      const movieTitle = movie.Title?.trim();

      if (!filmId || !movieTitle) {
        continue;
      }

      for (const session of movie.Sessions ?? []) {
        if (session.NewDate !== date) {
          continue;
        }

        const sessionTimes = [
          ...(session.Times ?? []).map((time) => ({
            fallbackExperiences: [] as LandmarkExperience[],
            time,
          })),
          ...(session.ExperienceTypes ?? []).flatMap(
            (experienceGroup) =>
              (experienceGroup.Times ?? []).map((time) => ({
                fallbackExperiences:
                  experienceGroup.ExperienceAttributes ?? [],
                time,
              })),
          ),
        ];

        for (const { fallbackExperiences, time } of sessionTimes) {
          const cinemaId = toId(time.CinemaId);
          const externalSessionId = toId(time.ExternalSessionId);
          const sessionId = toId(time.Scheduleid);
          const startsAt = time.StartTime
            ? localDateTimeToIso(date, time.StartTime, landmarkTheatre.timeZone)
            : undefined;

          if (
            cinemaId !== landmarkTheatre.providerTheatreId ||
            !externalSessionId ||
            !sessionId ||
            !startsAt ||
            time.SoldOut ||
            time.SessionExpired
          ) {
            continue;
          }

          const experiences = time.Experience?.length
            ? time.Experience
            : fallbackExperiences;
          const format = normalizeLandmarkFormat(
            experiences.map(
              (experience) =>
                experience.Name ?? experience.Description ?? "",
            ),
          );

          const bookingUrl = buildLandmarkPurchaseUrl({
            cinemaId,
            externalSessionId,
            filmId,
            sessionId,
          });

          if (!bookingUrl) {
            continue;
          }

          showtimes.push({
            auditorium: time.Screen?.trim() || undefined,
            format,
            id: `landmark-${cinemaId}-${sessionId}`,
            movieTitle,
            providerShowtimeId: sessionId,
            purchaseUrl: bookingUrl,
            seatPreviewUrl: bookingUrl,
            startsAt,
            theatreId: landmarkTheatre.id,
          });
        }
      }
    }

    return dedupeShowtimes(showtimes);
  }

  private async resolveSearchArea(
    query: Pick<
      SearchQuery,
      "location" | "radiusKm" | "latitude" | "longitude"
    >,
  ): Promise<{ origin?: Coordinates; theatres: LandmarkTheatre[] }> {
    const coordinates =
      query.latitude !== undefined && query.longitude !== undefined
        ? { latitude: query.latitude, longitude: query.longitude }
        : await resolveLocation(query.location);
    const text = query.location.trim().toLowerCase();
    const provinceCode = getProvinceCode(text);

    if (coordinates) {
      const theatres = LANDMARK_THEATRES.map((theatre) => ({
        distance: distanceKm(coordinates, {
          latitude: theatre.latitude as number,
          longitude: theatre.longitude as number,
        }),
        theatre,
      }))
        .filter((item) => item.distance <= query.radiusKm)
        .sort((a, b) => a.distance - b.distance)
        .map((item) => item.theatre);

      return { origin: coordinates, theatres };
    }

    if (provinceCode) {
      return {
        theatres: LANDMARK_THEATRES.filter(
          (theatre) => theatre.province === provinceCode,
        ),
      };
    }

    return {
      theatres: LANDMARK_THEATRES.filter((theatre) =>
        matchesTheatreText(theatre, text),
      ),
    };
  }

  private getTheatreMovies(
    theatre: LandmarkTheatre,
  ): Promise<LandmarkMovie[]> {
    const cached = this.requestMovieCache.get(theatre.slug);

    if (cached) {
      return cached;
    }

    const pending = fetchLandmarkMovies(this.movieApiOrigin, theatre);
    this.requestMovieCache.set(theatre.slug, pending);
    return pending;
  }
}

async function fetchLandmarkMovies(
  movieApiOrigin: string,
  theatre: LandmarkTheatre,
): Promise<LandmarkMovie[]> {
  const cacheSeconds = readPositiveInteger(
    process.env.LANDMARK_MOVIE_CACHE_SECONDS,
    DEFAULT_MOVIE_CACHE_SECONDS,
    MAX_MOVIE_CACHE_SECONDS,
  );
  const movieUrl = new URL(
    `/movies/${LANDMARK_CIRCUIT_ID}/${encodeURIComponent(theatre.providerTheatreId)}`,
    movieApiOrigin,
  ).toString();
  const now = Date.now();

  pruneMovieCache(now);
  const cached = sharedMovieCache.get(movieUrl);

  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  const value = fetchLandmarkMovieResponse(movieUrl);
  const entry = {
    expiresAt: now + cacheSeconds * 1_000,
    value,
  };

  if (sharedMovieCache.size >= MAX_MOVIE_CACHE_ENTRIES) {
    const oldestKey = sharedMovieCache.keys().next().value;

    if (oldestKey) {
      sharedMovieCache.delete(oldestKey);
    }
  }

  sharedMovieCache.set(movieUrl, entry);
  void value.catch(() => {
    if (sharedMovieCache.get(movieUrl) === entry) {
      sharedMovieCache.delete(movieUrl);
    }
  });

  return value;
}

async function fetchLandmarkMovieResponse(
  url: string,
): Promise<LandmarkMovie[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SOURCE_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      cache: "no-store",
      headers: {
        Accept: "application/json",
        "Accept-Language": "en-CA,en;q=0.9",
        Origin: LANDMARK_PUBLIC_ORIGIN,
        Referer: `${LANDMARK_PUBLIC_ORIGIN}/`,
        "User-Agent": standardUserAgent(),
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(
        `Landmark movie API failed with HTTP ${response.status}.`,
      );
    }

    return parseLandmarkMovies(await response.json());
  } finally {
    clearTimeout(timeout);
  }
}

function pruneMovieCache(now: number): void {
  for (const [key, cached] of sharedMovieCache) {
    if (cached.expiresAt <= now) {
      sharedMovieCache.delete(key);
    }
  }
}

export function parseLandmarkMovies(value: unknown): LandmarkMovie[] {
  if (!Array.isArray(value)) {
    throw new Error("Landmark returned invalid movie data.");
  }

  return value.filter(
    (movie): movie is LandmarkMovie =>
      typeof movie === "object" && movie !== null,
  );
}

export function buildLandmarkPurchaseUrl({
  cinemaId,
  externalSessionId,
  filmId,
  sessionId,
}: {
  cinemaId: string;
  externalSessionId: string;
  filmId: string;
  sessionId: string;
}): string | undefined {
  if (![cinemaId, externalSessionId, filmId, sessionId].every(isNumericId)) {
    return undefined;
  }

  const url = new URL("/booking", LANDMARK_PUBLIC_ORIGIN);
  url.searchParams.set("cinemaId", cinemaId);
  url.searchParams.set("filmId", filmId);
  url.searchParams.set("externalSessionId", externalSessionId);
  url.searchParams.set("sessionId", sessionId);
  return url.toString();
}

function requireLandmarkTheatre(theatre: Theatre): LandmarkTheatre {
  if (theatre.provider !== "landmark") {
    throw new Error("A Landmark theatre is required.");
  }

  const landmarkTheatre = getLandmarkTheatre(theatre.providerTheatreId);

  if (!landmarkTheatre) {
    throw new Error("The Landmark theatre is not supported.");
  }

  return landmarkTheatre;
}

function getValidatedSearchDates(
  query: Pick<SearchQuery, "date" | "endDate">,
): string[] {
  const dates = getSearchDates(query.date, query.endDate ?? query.date);

  if (!dates) {
    throw new Error("Search date range must contain one to three days.");
  }

  return dates;
}

function filterShowtimes(
  showtimes: Showtime[],
  query: SearchQuery,
  now: Date,
): Showtime[] {
  const movieFilter = query.movieTitle?.trim().toLowerCase();
  const twoHoursFromNow = new Date(now.getTime() + 2 * 60 * 60 * 1000);

  return showtimes.filter((showtime) => {
    if (isPastShowtime(showtime, now)) {
      return false;
    }

    const startsAt = new Date(showtime.startsAt);

    if (
      movieFilter &&
      !showtime.movieTitle.toLowerCase().includes(movieFilter)
    ) {
      return false;
    }

    if (query.nonVipOnly && /vip/i.test(showtime.format)) {
      return false;
    }

    if (
      !showtimeMatchesExperienceTypes(
        showtime.format,
        query.experienceTypes ?? [],
      )
    ) {
      return false;
    }

    if (!query.startsInNextTwoHours) {
      return true;
    }

    return startsAt <= twoHoursFromNow;
  });
}

function isPastShowtime(showtime: Showtime, now: Date): boolean {
  const startsAt = new Date(showtime.startsAt);
  return Number.isNaN(startsAt.getTime()) || startsAt < now;
}

function normalizeLandmarkFormat(rawExperiences: string[]): string {
  const formats = new Set<string>();

  for (const rawExperience of rawExperiences) {
    const experience = rawExperience.trim().toLowerCase();

    if (!experience) {
      continue;
    }

    if (experience === "2d") {
      formats.add("Regular");
    }

    if (/\bimax\b/.test(experience)) {
      formats.add("IMAX");
    }

    if (/\b3d\b/.test(experience)) {
      formats.add("3D");
    }

    if (/laser ultra/.test(experience)) {
      formats.add("Laser Ultra");
      formats.add("Laser Projection");
    }

    if (/recliner/.test(experience)) {
      formats.add("Recliner");
    }

    if (/premiere/.test(experience)) {
      formats.add("Premiere");
    }

    if (/screenx/.test(experience)) {
      formats.add("ScreenX");
    }

    if (/infinity vision/.test(experience)) {
      formats.add("Infinity Vision");
    }

    if (/\bvip\b/.test(experience)) {
      formats.add("VIP");
    }
  }

  if (!formats.size) {
    formats.add("Regular");
  }

  return Array.from(formats).join(", ");
}

function standardUserAgent(): string {
  return "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/139.0.0.0 Safari/537.36";
}

function toId(value: unknown): string | undefined {
  const id = toText(value).trim();
  return isNumericId(id) ? id : undefined;
}

function isNumericId(value: string): boolean {
  return /^\d+$/.test(value);
}

function toText(value: unknown): string {
  return typeof value === "string" || typeof value === "number"
    ? String(value)
    : "";
}

function readPositiveInteger(
  value: string | undefined,
  fallback: number,
  maximum: number,
): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0
    ? Math.min(parsed, maximum)
    : fallback;
}

function matchesTheatreText(
  theatre: LandmarkTheatre,
  text: string,
): boolean {
  const compactText = text.replace(/\s+/g, "");
  const fields = [
    theatre.name,
    theatre.city,
    theatre.province,
    theatre.address,
  ].filter((value): value is string => Boolean(value));

  return (
    fields.some((value) => value.toLowerCase().includes(text)) ||
    theatre.postalCode
      ?.toLowerCase()
      .replace(/\s+/g, "")
      .includes(compactText) === true
  );
}

function getDistanceFromOrigin(
  origin: Coordinates | undefined,
  theatre: LandmarkTheatre,
): number | undefined {
  return origin
    ? distanceKm(origin, {
        latitude: theatre.latitude as number,
        longitude: theatre.longitude as number,
      })
    : undefined;
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

    return primary || secondary;
  });
}

function sortShowtimeCandidates(
  candidates: ShowtimeCandidate[],
  sortBy: SortOption,
): ShowtimeCandidate[] {
  return candidates.sort((a, b) => {
    const direction = sortBy.endsWith("desc") ? -1 : 1;

    if (sortBy.startsWith("distance")) {
      return (
        compareOptionalNumber(a.distanceKm, b.distanceKm, direction) ||
        compareTimeValues(a.showtime.startsAt, b.showtime.startsAt, 1)
      );
    }

    return (
      compareTimeValues(a.showtime.startsAt, b.showtime.startsAt, direction) ||
      compareOptionalNumber(a.distanceKm, b.distanceKm, 1)
    );
  });
}

function interleaveCandidates(
  groups: ShowtimeCandidate[][],
): ShowtimeCandidate[] {
  const interleaved: ShowtimeCandidate[] = [];
  const longestGroup = Math.max(0, ...groups.map((group) => group.length));

  for (let index = 0; index < longestGroup; index += 1) {
    for (const group of groups) {
      const candidate = group[index];

      if (candidate) {
        interleaved.push(candidate);
      }
    }
  }

  return interleaved;
}

function dedupeShowtimes(showtimes: Showtime[]): Showtime[] {
  return Array.from(
    new Map(showtimes.map((showtime) => [showtime.id, showtime])).values(),
  );
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

function normalizeSuggestionTerms(value: string): string[] {
  return value
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter((term) => term.length >= 2);
}

function matchesMovieTitle(title: string, terms: string[]): boolean {
  const normalizedTitle = title.toLowerCase();
  return terms.every((term) => normalizedTitle.includes(term));
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
