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
import { buildSeatSnapshot } from "./seat-scoring";
import type {
  MovieSuggestion,
  MovieSuggestionQuery,
  RawSeat,
  SearchQuery,
  SearchResult,
  SeatSnapshot,
  Showtime,
  SortOption,
  Theatre,
} from "./types";

const LANDMARK_PUBLIC_ORIGIN = "https://www.landmarkcinemas.com";
const DEFAULT_SOURCE_ORIGINS = [
  LANDMARK_PUBLIC_ORIGIN,
  "https://web5.landmarkcinemas.com",
];
const LANDMARK_READER_ORIGIN = "https://r.jina.ai";
const DEFAULT_READER_CACHE_SECONDS = 60;
const MAX_READER_CACHE_SECONDS = 300;
const MAX_READER_CACHE_ENTRIES = 16;
const SEAT_CHECK_CONCURRENCY = 4;
const MAX_SUGGESTION_THEATRES = 8;
const SOURCE_TIMEOUT_MS = 10_000;

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
};

export type LandmarkMovie = {
  FilmId?: number | string;
  Sessions?: LandmarkSession[];
  Title?: string;
};

type LandmarkPageContext = {
  cookieHeader: string;
  movies: LandmarkMovie[];
  origin: string;
  token: string;
};

type CachedLandmarkPage = {
  expiresAt: number;
  value: Promise<LandmarkPageContext>;
};

const readerPageCache = new Map<string, CachedLandmarkPage>();

type LandmarkSeatRecord = Record<string, unknown> & {
  Column?: number | string;
  Row?: number | string;
  SeatId?: number | string;
  SeatName?: string;
  Status?: number | string;
  Style?: number | string;
  Type?: number | string;
};

type LandmarkSeatMapResponse = {
  Data?: unknown;
  ResultCode?: number | string;
  ResultMessage?: string;
};

type ShowtimeCandidate = {
  distanceKm?: number;
  showtime: Showtime;
  theatre: LandmarkTheatre;
};

export type LandmarkPreviewSeat = {
  accessible: boolean;
  column: number;
  id: string;
  label: string;
  status: "available" | "unavailable";
};

export type LandmarkPreviewRow = {
  label: string;
  seats: LandmarkPreviewSeat[];
};

export type LandmarkSeatPreview = {
  checkedAt: string;
  rows: LandmarkPreviewRow[];
  snapshot: SeatSnapshot;
};

export class LandmarkClient {
  private readonly pageCache = new Map<
    string,
    Promise<LandmarkPageContext>
  >();
  private readonly readerFirst: boolean;
  private readonly sourceOrigins: readonly string[];

  constructor(sourceOrigins?: readonly string[]) {
    this.readerFirst = sourceOrigins === undefined;
    this.sourceOrigins = sourceOrigins ?? getConfiguredSourceOrigins();
  }

  async search(query: SearchQuery): Promise<SearchResult[]> {
    return this.performSearch(query);
  }

  private async performSearch(query: SearchQuery): Promise<SearchResult[]> {
    const { origin, theatres } = await this.resolveSearchArea(query);
    const searchDates = getValidatedSearchDates(query);
    const maxTheatres = readPositiveInteger(
      process.env.LANDMARK_MAX_THEATRES_PER_SEARCH,
      5,
      LANDMARK_THEATRES.length,
    );
    const maxSeatChecks = readPositiveInteger(
      process.env.LANDMARK_MAX_SEAT_CHECKS_PER_SEARCH,
      40,
      100,
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
        for (const showtime of filterShowtimes(showtimes, query)) {
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
    ).slice(0, maxSeatChecks);
    const results: SearchResult[] = [];
    let successfulSeatChecks = 0;
    let lastSeatError: unknown;

    for (
      let offset = 0;
      offset < candidates.length;
      offset += SEAT_CHECK_CONCURRENCY
    ) {
      const batch = await Promise.allSettled(
        candidates
          .slice(offset, offset + SEAT_CHECK_CONCURRENCY)
          .map(async (candidate) => ({
            distanceKm: candidate.distanceKm,
            showtime: candidate.showtime,
            snapshot: await this.getSeatSnapshot(
              candidate.theatre,
              candidate.showtime,
            ),
            theatre: candidate.theatre,
          })),
      );

      for (const settled of batch) {
        if (settled.status === "rejected") {
          lastSeatError = settled.reason;
          continue;
        }

        successfulSeatChecks += 1;

        if (matchesSnapshotFilters(settled.value, query)) {
          results.push(settled.value);
        }
      }
    }

    if (candidates.length > 0 && successfulSeatChecks === 0) {
      throw lastSeatError instanceof Error
        ? lastSeatError
        : new Error("Landmark seat previews are unavailable.");
    }

    return sortResults(results, sortBy);
  }

  async suggestMovieTitles(
    query: MovieSuggestionQuery,
  ): Promise<MovieSuggestion[]> {
    return this.performSuggestMovieTitles(query);
  }

  private async performSuggestMovieTitles(
    query: MovieSuggestionQuery,
  ): Promise<MovieSuggestion[]> {
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
    const { movies } = await this.getTheatrePage(landmarkTheatre);
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

        for (const experienceGroup of session.ExperienceTypes ?? []) {
          for (const time of experienceGroup.Times ?? []) {
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

            const experiences =
              time.Experience?.length
                ? time.Experience
                : (experienceGroup.ExperienceAttributes ?? []);
            const format = normalizeLandmarkFormat(
              experiences.map(
                (experience) =>
                  experience.Name ?? experience.Description ?? "",
              ),
            );

            showtimes.push({
              auditorium: time.Screen?.trim() || undefined,
              format,
              id: `landmark-${cinemaId}-${sessionId}`,
              movieTitle,
              providerShowtimeId: sessionId,
              purchaseUrl: buildLandmarkPurchaseUrl({
                cinemaId,
                externalSessionId,
                filmId,
                sessionId,
              }),
              seatPreviewUrl: buildLandmarkSeatPreviewUrl({
                cinemaId,
                externalSessionId,
                filmId,
                movieTitle,
                sessionId,
                startsAt,
              }),
              startsAt,
              theatreId: landmarkTheatre.id,
            });
          }
        }
      }
    }

    return dedupeShowtimes(showtimes);
  }

  async getSeatSnapshot(
    theatre: Theatre,
    showtime: Showtime,
  ): Promise<SeatSnapshot> {
    const preview = await this.getSeatPreview(
      theatre,
      showtime.providerShowtimeId,
      getExternalSessionId(showtime.purchaseUrl),
    );
    return preview.snapshot;
  }

  async getSeatPreview(
    theatre: Theatre,
    sessionId: string,
    externalSessionId?: string,
  ): Promise<LandmarkSeatPreview> {
    if (!isNumericId(sessionId)) {
      throw new Error("The Landmark session ID is invalid.");
    }

    const landmarkTheatre = requireLandmarkTheatre(theatre);
    const context = await this.getTheatrePage(landmarkTheatre);

    const data = await this.getSeatMapData(
      context,
      landmarkTheatre,
      sessionId,
      externalSessionId,
    );

    if (Number(data.ResultCode) !== 0 || data.Data === undefined) {
      throw new Error(
        data.ResultMessage?.trim() || "Landmark disabled this seat preview.",
      );
    }

    const records = collectSeatRecords(data.Data);

    if (!records.length) {
      throw new Error("Landmark returned an empty seat preview.");
    }

    const checkedAt = new Date();
    const snapshot = buildSeatSnapshot(records.map(toRawSeat), checkedAt);

    return {
      checkedAt: checkedAt.toISOString(),
      rows: buildPreviewRows(records),
      snapshot,
    };
  }

  private async getSeatMapData(
    context: LandmarkPageContext,
    theatre: LandmarkTheatre,
    sessionId: string,
    externalSessionId?: string,
  ): Promise<LandmarkSeatMapResponse> {
    if (!externalSessionId || !isNumericId(externalSessionId)) {
      throw new Error("The Landmark external session ID is invalid.");
    }

    const origins = Array.from(
      new Set([context.origin, ...this.sourceOrigins, LANDMARK_PUBLIC_ORIGIN]),
    );
    const failures: unknown[] = [];

    for (const origin of origins) {
      try {
        return await fetchLandmarkSeatMap({
          context,
          externalSessionId,
          origin,
          sessionId,
          theatre,
        });
      } catch (error) {
        failures.push(error);
      }
    }

    throw new AggregateError(
      failures,
      "Landmark seat previews are unavailable.",
    );
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

  private getTheatrePage(
    theatre: LandmarkTheatre,
  ): Promise<LandmarkPageContext> {
    const cached = this.pageCache.get(theatre.slug);

    if (cached) {
      return cached;
    }

    const pending = this.fetchTheatrePage(theatre);
    this.pageCache.set(theatre.slug, pending);
    return pending;
  }

  private async fetchTheatrePage(
    theatre: LandmarkTheatre,
  ): Promise<LandmarkPageContext> {
    const failures: unknown[] = [];

    if (this.readerFirst) {
      try {
        return await fetchLandmarkReaderPage(theatre);
      } catch (error) {
        failures.push(error);
      }
    }

    try {
      return await Promise.any(
        this.sourceOrigins.map((origin) =>
          fetchLandmarkOriginPage(origin, theatre),
        ),
      );
    } catch (error) {
      failures.push(error);
    }

    if (!this.readerFirst) {
      try {
        return await fetchLandmarkReaderPage(theatre);
      } catch (error) {
        failures.push(error);
      }
    }

    throw new AggregateError(
      failures,
      `Landmark showtimes are unavailable for ${theatre.name}.`,
    );
  }
}

async function fetchLandmarkSeatMap({
  context,
  externalSessionId,
  origin,
  sessionId,
  theatre,
}: {
  context: LandmarkPageContext;
  externalSessionId: string;
  origin: string;
  sessionId: string;
  theatre: LandmarkTheatre;
}): Promise<LandmarkSeatMapResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SOURCE_TIMEOUT_MS);
  const headers = new Headers({
    Accept: "application/json, text/javascript, */*; q=0.01",
    "Accept-Language": "en-CA,en;q=0.9",
    "Content-Type": "application/json; charset=UTF-8",
    Origin: origin,
    Referer: `${origin}/showtimes/${theatre.slug}`,
    "User-Agent": browserUserAgent(),
    "X-Requested-With": "XMLHttpRequest",
    "X-XSRF-TOKEN": context.token,
  });

  if (context.cookieHeader && origin === context.origin) {
    headers.set("Cookie", context.cookieHeader);
  }

  try {
    const response = await fetch(
      `${origin}/Umbraco/Api/SeatMapApi/GetSessionSeatMap`,
      {
        body: JSON.stringify({
          CinemaId: theatre.providerTheatreId,
          ExternalSessionId: externalSessionId,
          SessionId: sessionId,
        }),
        cache: "no-store",
        headers,
        method: "POST",
        signal: controller.signal,
      },
    );

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(
        `Landmark seat preview failed with HTTP ${response.status}: ${body.slice(0, 160)}`,
      );
    }

    return (await response.json()) as LandmarkSeatMapResponse;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchLandmarkReaderPage(
  theatre: LandmarkTheatre,
): Promise<LandmarkPageContext> {
  const cacheSeconds = readPositiveInteger(
    process.env.LANDMARK_READER_CACHE_SECONDS,
    DEFAULT_READER_CACHE_SECONDS,
    MAX_READER_CACHE_SECONDS,
  );
  const targetUrl = new URL(
    `/showtimes/${encodeURIComponent(theatre.slug)}`,
    LANDMARK_PUBLIC_ORIGIN,
  ).toString();
  const readerUrl = `${LANDMARK_READER_ORIGIN}/${targetUrl}`;
  const now = Date.now();

  pruneReaderPageCache(now);
  const cached = readerPageCache.get(readerUrl);

  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  const value = fetchLandmarkPageResponse(readerUrl, {
    headers: buildReaderHeaders(cacheSeconds),
  }).then(({ html }) => parseLandmarkPage(html, LANDMARK_PUBLIC_ORIGIN, ""));
  const entry = {
    expiresAt: now + cacheSeconds * 1_000,
    value,
  };

  if (readerPageCache.size >= MAX_READER_CACHE_ENTRIES) {
    const oldestKey = readerPageCache.keys().next().value;

    if (oldestKey) {
      readerPageCache.delete(oldestKey);
    }
  }

  readerPageCache.set(readerUrl, entry);
  void value.catch(() => {
    if (readerPageCache.get(readerUrl) === entry) {
      readerPageCache.delete(readerUrl);
    }
  });

  return value;
}

async function fetchLandmarkOriginPage(
  origin: string,
  theatre: LandmarkTheatre,
): Promise<LandmarkPageContext> {
  const url = `${origin}/showtimes/${encodeURIComponent(theatre.slug)}`;
  const { headers, html } = await fetchLandmarkPageResponse(url, {
    headers: {
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-CA,en;q=0.9",
      "User-Agent": browserUserAgent(),
    },
  });

  return parseLandmarkPage(html, origin, extractCookieHeader(headers));
}

async function fetchLandmarkPageResponse(
  url: string,
  init: Pick<RequestInit, "headers">,
): Promise<{ headers: Headers; html: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SOURCE_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      cache: "no-store",
      headers: init.headers,
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(
        `Landmark showtimes failed with HTTP ${response.status}.`,
      );
    }

    return {
      headers: response.headers,
      html: await response.text(),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function parseLandmarkPage(
  html: string,
  origin: string,
  cookieHeader: string,
): LandmarkPageContext {
  const token = extractAntiForgeryToken(html);

  if (!token) {
    throw new Error("Landmark did not include its anti-forgery token.");
  }

  return {
    cookieHeader,
    movies: extractLandmarkMovies(html),
    origin,
    token,
  };
}

function buildReaderHeaders(cacheSeconds: number): Headers {
  const headers = new Headers({
    Accept: "text/html",
    "X-Cache-Tolerance": String(cacheSeconds),
    "X-Engine": "direct",
    "X-Respond-With": "html",
    "X-Timeout": String(Math.ceil(SOURCE_TIMEOUT_MS / 1_000)),
  });
  const apiKey = process.env.JINA_API_KEY?.trim();

  if (apiKey) {
    headers.set("Authorization", `Bearer ${apiKey}`);
  }

  return headers;
}

function pruneReaderPageCache(now: number): void {
  for (const [key, cached] of readerPageCache) {
    if (cached.expiresAt <= now) {
      readerPageCache.delete(key);
    }
  }
}

export function extractLandmarkMovies(html: string): LandmarkMovie[] {
  const sectionMatch = /(?:["']nowbooking["']|nowbooking)\s*:\s*\{/i.exec(
    html,
  );

  if (!sectionMatch) {
    throw new Error("Landmark did not include its showtime data.");
  }

  const sectionStart = sectionMatch.index + sectionMatch[0].length;
  const zeroMatch = /["']0["']\s*:\s*/.exec(html.slice(sectionStart));

  if (!zeroMatch) {
    throw new Error("Landmark did not include its current movies.");
  }

  const searchStart = sectionStart + zeroMatch.index + zeroMatch[0].length;
  const arrayStart = html.indexOf("[", searchStart);

  if (arrayStart < 0) {
    throw new Error("Landmark returned malformed showtime data.");
  }

  const arrayEnd = findJsonArrayEnd(html, arrayStart);

  try {
    const parsed = JSON.parse(html.slice(arrayStart, arrayEnd));

    if (!Array.isArray(parsed)) {
      throw new Error("The movie payload is not an array.");
    }

    return parsed as LandmarkMovie[];
  } catch (error) {
    throw new Error("Landmark returned invalid showtime data.", {
      cause: error,
    });
  }
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

export function localDateTimeToIso(
  date: string,
  time: string,
  timeZone: string,
): string | undefined {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const timeMatch = /^(\d{1,2}):(\d{2})\s*([AP]M)$/i.exec(time.trim());

  if (!dateMatch || !timeMatch) {
    return undefined;
  }

  let hour = Number(timeMatch[1]) % 12;

  if (timeMatch[3].toUpperCase() === "PM") {
    hour += 12;
  }

  const targetLocalAsUtc = Date.UTC(
    Number(dateMatch[1]),
    Number(dateMatch[2]) - 1,
    Number(dateMatch[3]),
    hour,
    Number(timeMatch[2]),
  );
  const formatter = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
    month: "2-digit",
    timeZone,
    year: "numeric",
  });
  let instant = targetLocalAsUtc;

  for (let iteration = 0; iteration < 3; iteration += 1) {
    const parts = Object.fromEntries(
      formatter
        .formatToParts(new Date(instant))
        .filter((part) => part.type !== "literal")
        .map((part) => [part.type, Number(part.value)]),
    );
    const formattedLocalAsUtc = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
    );
    const adjustment = targetLocalAsUtc - formattedLocalAsUtc;

    instant += adjustment;

    if (adjustment === 0) {
      break;
    }
  }

  return new Date(instant).toISOString();
}

function getConfiguredSourceOrigins(): string[] {
  const configured = process.env.LANDMARK_SOURCE_ORIGIN?.trim();

  if (!configured) {
    return DEFAULT_SOURCE_ORIGINS;
  }

  const origins = Array.from(
    new Set(
      configured
        .split(",")
        .map((origin) => origin.trim().replace(/\/$/, ""))
        .filter((origin) => /^https:\/\//i.test(origin)),
    ),
  );

  return origins.length > 0 ? origins : DEFAULT_SOURCE_ORIGINS;
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
): Showtime[] {
  const movieFilter = query.movieTitle?.trim().toLowerCase();
  const now = new Date();
  const twoHoursFromNow = new Date(now.getTime() + 2 * 60 * 60 * 1000);

  return showtimes.filter((showtime) => {
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

    const startsAt = new Date(showtime.startsAt);
    return startsAt >= now && startsAt <= twoHoursFromNow;
  });
}

function matchesSnapshotFilters(
  result: SearchResult,
  query: SearchQuery,
): boolean {
  return (
    (!query.onlyZeroSold || result.snapshot.occupiedEstimate === 0) &&
    (!query.maxFiveSold || result.snapshot.occupiedEstimate <= 5) &&
    (!query.accessibleAvailable || result.snapshot.accessibilityCount > 0)
  );
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

function buildLandmarkSeatPreviewUrl({
  cinemaId,
  externalSessionId,
  filmId,
  movieTitle,
  sessionId,
  startsAt,
}: {
  cinemaId: string;
  externalSessionId: string;
  filmId: string;
  movieTitle: string;
  sessionId: string;
  startsAt: string;
}): string {
  const params = new URLSearchParams({
    cinemaId,
    externalSessionId,
    filmId,
    sessionId,
    startsAt,
    title: movieTitle,
  });
  return `/landmark-seat-preview?${params}`;
}

function getExternalSessionId(purchaseUrl: string | undefined): string | undefined {
  if (!purchaseUrl) {
    return undefined;
  }

  try {
    return toId(new URL(purchaseUrl).searchParams.get("externalSessionId"));
  } catch {
    return undefined;
  }
}

function findJsonArrayEnd(value: string, start: number): number {
  let depth = 0;
  let escaped = false;
  let inString = false;

  for (let index = start; index < value.length; index += 1) {
    const character = value[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }

      continue;
    }

    if (character === '"') {
      inString = true;
    } else if (character === "[") {
      depth += 1;
    } else if (character === "]") {
      depth -= 1;

      if (depth === 0) {
        return index + 1;
      }
    }
  }

  throw new Error("Landmark returned an incomplete showtime payload.");
}

function extractAntiForgeryToken(html: string): string | undefined {
  const input = html.match(
    /<input\b[^>]*\bid=["']AntiForgeryToken["'][^>]*>/i,
  )?.[0];
  const value = input?.match(/\bvalue=["']([^"']+)["']/i)?.[1];
  return value ? decodeHtmlEntities(value) : undefined;
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    );
}

function extractCookieHeader(headers: Headers): string {
  const headersWithCookies = headers as Headers & {
    getSetCookie?: () => string[];
  };
  const values =
    headersWithCookies.getSetCookie?.() ??
    splitSetCookieHeader(headers.get("set-cookie"));

  return values
    .map((value) => value.split(";", 1)[0]?.trim())
    .filter(Boolean)
    .join("; ");
}

function splitSetCookieHeader(value: string | null): string[] {
  if (!value) {
    return [];
  }

  return value.split(/,(?=\s*[^;,=\s]+=[^;,]*)/);
}

function collectSeatRecords(value: unknown): LandmarkSeatRecord[] {
  const records = new Map<string, LandmarkSeatRecord>();

  function visit(current: unknown): void {
    if (Array.isArray(current)) {
      for (const item of current) {
        visit(item);
      }

      return;
    }

    if (!current || typeof current !== "object") {
      return;
    }

    const object = current as LandmarkSeatRecord;
    const id = toText(object.SeatId) || toText(object.SeatName);

    if (id && object.Status !== undefined) {
      records.set(id, object);
      return;
    }

    for (const child of Object.values(object)) {
      visit(child);
    }
  }

  visit(value);
  return Array.from(records.values());
}

function toRawSeat(record: LandmarkSeatRecord): RawSeat {
  return {
    status: isSeatAvailable(record.Status) ? "available" : "occupied",
    type: getAccessibilityType(record),
  };
}

function buildPreviewRows(
  records: LandmarkSeatRecord[],
): LandmarkPreviewRow[] {
  const rows = new Map<string, LandmarkPreviewSeat[]>();

  records.forEach((record, index) => {
    const label = toText(record.SeatName) || `Seat ${index + 1}`;
    const rowLabel = getSeatRowLabel(record, label);
    const row = rows.get(rowLabel) ?? [];
    const accessibilityType = getAccessibilityType(record);

    row.push({
      accessible: Boolean(accessibilityType),
      column: getSeatColumn(record, label, index),
      id: toText(record.SeatId) || label,
      label,
      status: isSeatAvailable(record.Status) ? "available" : "unavailable",
    });
    rows.set(rowLabel, row);
  });

  return Array.from(rows, ([label, seats]) => ({
    label,
    seats: seats.sort(
      (a, b) => a.column - b.column || a.label.localeCompare(b.label),
    ),
  })).sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
}

function getAccessibilityType(
  record: LandmarkSeatRecord,
): "wheelchair" | "companion" | undefined {
  const label = toText(record.SeatName).toLowerCase();
  const details = [
    record.Type,
    record.Style,
    record.SeatType,
    record.Description,
  ]
    .map(toText)
    .join(" ")
    .toLowerCase();

  if (/\bwc\d*\b|wheelchair/.test(label) || /wheelchair/.test(details)) {
    return "wheelchair";
  }

  if (/companion/.test(label) || /companion/.test(details)) {
    return "companion";
  }

  if (Number(record.Type) === 2) {
    return "wheelchair";
  }

  if (Number(record.Style) === 4) {
    return "companion";
  }

  return undefined;
}

function isSeatAvailable(status: unknown): boolean {
  const normalized = toText(status).trim().toLowerCase();
  return normalized === "0" || normalized === "available";
}

function getSeatRowLabel(
  record: LandmarkSeatRecord,
  seatLabel: string,
): string {
  const labelRow = seatLabel.includes("-")
    ? seatLabel.split("-", 1)[0]?.trim()
    : undefined;

  if (labelRow) {
    return labelRow;
  }

  const row = toText(record.Row).trim();

  if (row) {
    return row;
  }

  return "Seats";
}

function getSeatColumn(
  record: LandmarkSeatRecord,
  seatLabel: string,
  fallback: number,
): number {
  const explicitColumn = Number(record.Column);

  if (Number.isFinite(explicitColumn)) {
    return explicitColumn;
  }

  const labelColumn = Number(seatLabel.match(/(\d+)$/)?.[1]);
  return Number.isFinite(labelColumn) ? labelColumn : fallback;
}

function browserUserAgent(): string {
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
  results: SearchResult[],
  sortBy: SortOption,
): SearchResult[] {
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
