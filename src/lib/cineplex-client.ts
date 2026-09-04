import tzLookup from "@photostructure/tz-lookup";
import {
  distanceKm,
  getProvinceCode,
  resolveLocation,
  type Coordinates,
} from "./geo";
import { getSearchDates } from "./date-range";
import { showtimeMatchesExperienceTypes } from "./experience-types";
import { normalizeLocalIsoDateTime } from "./showtime-time";
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

const THEATRICAL_API_BASE = "https://apis.cineplex.com/prod/cpx/theatrical/api";
const TICKETING_API_BASE = "https://apis.cineplex.com/prod/ticketing/api";
const PUBLIC_SITE_KEY = "dcdac5601d864addbc2675a2e96cb1f8";
const SEAT_CHECK_CONCURRENCY = 4;
const MAX_SUGGESTION_THEATRES = 8;

type CineplexTheatresResponse = {
  favouriteTheatres?: CineplexTheatre[];
  nearbyTheatres?: CineplexTheatre[];
  otherTheatres?: CineplexTheatre[];
};

type CineplexTheatre = {
  theatreId: number;
  theatreName: string;
  location?: {
    geoLocation?: {
      latitude?: number;
      longitude?: number;
    };
    address?: string;
    city?: string;
    provinceCode?: string;
    postalCode?: string;
  };
};

type CineplexShowtimeResponse = Array<{
  dates: Array<{
    movies: CineplexMovieShowtime[];
  }>;
}>;

type CineplexMovieShowtime = {
  name: string;
  experiences?: Array<{
    experienceTypes?: string[];
    sessions?: CineplexSession[];
  }>;
};

type CineplexSession = {
  vistaSessionId: number;
  showStartDateTime: string;
  deeplinkUrl?: string;
  seatMapUrl?: string;
  isShowtimeEnabledOnline?: boolean;
  isSoldOut?: boolean;
  isInThePast?: boolean;
  isReservedSeating?: boolean;
  auditorium?: string;
};

type SeatLayoutArea = {
  rows?: Array<{
    seats?: Array<{
      id: string;
      type?: string;
    }>;
  }>;
};

type SeatLayout = {
  standardSeats?: SeatLayoutArea;
  dboxSeats?: SeatLayoutArea;
  balconySeats?: SeatLayoutArea;
};

type SeatAvailability = {
  seatAvailabilities?: Record<string, string>;
};

type ShowtimeCandidate = {
  theatre: Theatre;
  showtime: Showtime;
  distanceKm?: number;
};

export class CineplexClient {
  private readonly headers: HeadersInit;
  private readonly now: () => Date;

  constructor(
    subscriptionKey = process.env.CINEPLEX_APIM_SUBSCRIPTION_KEY ||
      PUBLIC_SITE_KEY,
    now: () => Date = () => new Date(),
  ) {
    this.headers = {
      Accept: "application/json",
      "Ocp-Apim-Subscription-Key": subscriptionKey,
    };
    this.now = now;
  }

  async search(query: SearchQuery): Promise<SearchResult[]> {
    const searchStartedAt = this.now();
    const { origin, theatres } = await this.resolveSearchArea(query);
    const searchDates = getValidatedSearchDates(query);
    const maxTheatres = Number(
      process.env.CINEPLEX_MAX_THEATRES_PER_SEARCH ?? 5,
    );
    const maxSeatChecks = Number(
      process.env.CINEPLEX_MAX_SEAT_CHECKS_PER_SEARCH ?? 40,
    );
    const sortBy = query.sortBy ?? "distance-asc";
    const candidateGroups: ShowtimeCandidate[][] = searchDates.map(() => []);
    const results: SearchResult[] = [];

    const showtimeGroups = await Promise.all(
      theatres.slice(0, maxTheatres).map(async (theatre) => ({
        theatre,
        showtimesByDate: await Promise.all(
          searchDates.map((date) => this.getShowtimes(theatre, date)),
        ),
      })),
    );

    for (const { theatre, showtimesByDate } of showtimeGroups) {
      for (const [dateIndex, showtimes] of showtimesByDate.entries()) {
        const matchingShowtimes = this.filterShowtimes(
          showtimes,
          query,
          searchStartedAt,
        );

        for (const showtime of matchingShowtimes) {
          candidateGroups[dateIndex].push({
            theatre,
            showtime,
            distanceKm: getDistanceFromOrigin(origin, theatre),
          });
        }
      }
    }

    const sortedCandidateGroups = candidateGroups.map((candidates) =>
      sortShowtimeCandidates(candidates, sortBy),
    );

    const candidates = Array.from(
      new Map(
        interleaveCandidates(sortedCandidateGroups).map((candidate) => [
          candidate.showtime.id,
          candidate,
        ]),
      ).values(),
    ).slice(0, maxSeatChecks);

    for (
      let offset = 0;
      offset < candidates.length;
      offset += SEAT_CHECK_CONCURRENCY
    ) {
      const batch = await Promise.all(
        candidates
          .slice(offset, offset + SEAT_CHECK_CONCURRENCY)
          .map(async (candidate) => ({
            theatre: candidate.theatre,
            showtime: candidate.showtime,
            snapshot: await this.getSeatSnapshot(
              candidate.theatre,
              candidate.showtime,
            ),
            distanceKm: candidate.distanceKm,
          })),
      );

      for (const result of batch) {
        if (this.matchesSnapshotFilters(result, query)) {
          results.push(result);
        }
      }
    }

    return sortResults(results, sortBy);
  }

  async suggestMovieTitles(
    query: MovieSuggestionQuery,
  ): Promise<MovieSuggestion[]> {
    const suggestionStartedAt = this.now();
    const terms = normalizeSuggestionTerms(query.movieTitle);

    if (!terms.length) {
      return [];
    }

    const limit = query.limit ?? 8;
    const searchDates = getValidatedSearchDates(query);
    const theatres = (await this.resolveSearchArea(query)).theatres;
    const showtimeGroups = await Promise.all(
      theatres.slice(0, MAX_SUGGESTION_THEATRES).map(async (theatre) => ({
        theatre,
        showtimes: dedupeShowtimes(
          (
            await Promise.all(
              searchDates.map((date) => this.getShowtimes(theatre, date)),
            )
          ).flat(),
        ),
      })),
    );
    const suggestionsByTitle = new Map<
      string,
      { title: string; theatreIds: Set<string>; showtimeCount: number }
    >();

    for (const { theatre, showtimes } of showtimeGroups) {
      for (const showtime of showtimes) {
        if (isPastShowtime(showtime, suggestionStartedAt)) {
          continue;
        }

        if (!matchesMovieTitle(showtime.movieTitle, terms)) {
          continue;
        }

        const key = showtime.movieTitle.toLowerCase();
        const suggestion = suggestionsByTitle.get(key) ?? {
          title: showtime.movieTitle,
          theatreIds: new Set<string>(),
          showtimeCount: 0,
        };

        suggestion.theatreIds.add(theatre.id);
        suggestion.showtimeCount += 1;
        suggestionsByTitle.set(key, suggestion);
      }
    }

    return Array.from(suggestionsByTitle.values())
      .map((suggestion) => ({
        title: suggestion.title,
        theatreCount: suggestion.theatreIds.size,
        showtimeCount: suggestion.showtimeCount,
      }))
      .sort((a, b) => compareMovieSuggestions(a, b, query.movieTitle))
      .slice(0, limit);
  }

  private async resolveSearchArea(
    query: Pick<
      SearchQuery,
      "location" | "radiusKm" | "latitude" | "longitude"
    >,
  ): Promise<{ origin?: Coordinates; theatres: Theatre[] }> {
    const response = await this.getJson<CineplexTheatresResponse>(
      `${THEATRICAL_API_BASE}/v1/theatres?language=en`,
    );
    const rawTheatres = [
      ...(response.favouriteTheatres ?? []),
      ...(response.nearbyTheatres ?? []),
      ...(response.otherTheatres ?? []),
    ];
    const theatres = rawTheatres.map(toTheatre);
    const coordinates =
      query.latitude !== undefined && query.longitude !== undefined
        ? { latitude: query.latitude, longitude: query.longitude }
        : await resolveLocation(query.location);
    const text = query.location.trim().toLowerCase();
    const provinceCode = getProvinceCode(text);
    const textMatches = theatres.filter((theatre) =>
      matchesTheatreText(theatre, text),
    );
    if (coordinates) {
      const matchedTheatres = theatres
        .map((theatre) => ({
          theatre,
          distance:
            theatre.latitude !== undefined && theatre.longitude !== undefined
              ? distanceKm(coordinates, {
                  latitude: theatre.latitude,
                  longitude: theatre.longitude,
                })
              : Number.POSITIVE_INFINITY,
        }))
        .filter((item) => item.distance <= query.radiusKm)
        .sort((a, b) => a.distance - b.distance)
        .map((item) => item.theatre);

      return { origin: coordinates, theatres: matchedTheatres };
    }

    if (provinceCode) {
      return {
        theatres: theatres.filter(
          (theatre) => theatre.province.toUpperCase() === provinceCode,
        ),
      };
    }

    return { theatres: textMatches };
  }

  async getShowtimes(theatre: Theatre, date: string): Promise<Showtime[]> {
    const url = `${THEATRICAL_API_BASE}/v1/showtimes?${new URLSearchParams({
      language: "en",
      locationId: theatre.providerTheatreId,
      date,
    })}`;
    const response = await this.getJson<CineplexShowtimeResponse>(url, []);
    const showtimes: Showtime[] = [];

    for (const theatreShowtimes of response) {
      for (const showDate of theatreShowtimes.dates) {
        for (const movie of showDate.movies) {
          for (const experience of movie.experiences ?? []) {
            for (const session of experience.sessions ?? []) {
              if (
                session.isSoldOut ||
                session.isInThePast ||
                !session.isReservedSeating
              ) {
                continue;
              }

              const format = (experience.experienceTypes ?? ["Regular"]).join(
                ", ",
              );
              const dbox = /D-BOX/i.test(format);
              const startsAt = normalizeLocalIsoDateTime(
                session.showStartDateTime,
                theatre.timeZone,
              );

              if (!startsAt) {
                continue;
              }

              showtimes.push({
                id: `cineplex-${theatre.providerTheatreId}-${session.vistaSessionId}`,
                providerShowtimeId: String(session.vistaSessionId),
                theatreId: theatre.id,
                movieTitle: movie.name,
                startsAt,
                format,
                auditorium: session.auditorium,
                purchaseUrl:
                  session.isShowtimeEnabledOnline === false
                    ? undefined
                    : normalizePublicPurchaseUrl(session.deeplinkUrl),
                seatPreviewUrl: buildPublicSeatMapUrl(
                  theatre.providerTheatreId,
                  session,
                  dbox,
                ),
              });
            }
          }
        }
      }
    }

    return showtimes;
  }

  async getSeatSnapshot(
    theatre: Theatre,
    showtime: Showtime,
  ): Promise<SeatSnapshot> {
    const [layout, availability] = await Promise.all([
      this.getJson<SeatLayout>(
        `${TICKETING_API_BASE}/v1/theatre/${theatre.providerTheatreId}/showtime/${showtime.providerShowtimeId}/seat-layout`,
      ),
      this.getJson<SeatAvailability>(
        `${TICKETING_API_BASE}/v1/theatre/${theatre.providerTheatreId}/showtime/${showtime.providerShowtimeId}/seat-availability?preview=true`,
      ),
    ]);

    return buildSeatSnapshot(toRawSeats(layout, availability));
  }

  private async getJson<T>(url: string, emptyFallback?: T): Promise<T> {
    const response = await fetch(url, {
      headers: this.headers,
      cache: "no-store",
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(
        `Cineplex GET failed ${response.status} for ${url}: ${body.slice(0, 300)}`,
      );
    }

    const text = await response.text();

    if (!text.trim() && emptyFallback !== undefined) {
      return emptyFallback;
    }

    try {
      return JSON.parse(text) as T;
    } catch {
      throw new Error(
        `Cineplex returned invalid JSON for ${url}: ${text.slice(0, 300)}`,
      );
    }
  }

  private filterShowtimes(
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

  private matchesSnapshotFilters(
    result: SearchResult,
    query: SearchQuery,
  ): boolean {
    return (
      (!query.onlyZeroSold || result.snapshot.occupiedEstimate === 0) &&
      (!query.maxFiveSold || result.snapshot.occupiedEstimate <= 5) &&
      (!query.accessibleAvailable || result.snapshot.accessibilityCount > 0)
    );
  }
}

function isPastShowtime(showtime: Showtime, now: Date): boolean {
  const startsAt = new Date(showtime.startsAt);
  return Number.isNaN(startsAt.getTime()) || startsAt < now;
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

function sortResults(
  results: SearchResult[],
  sortBy: SortOption,
): SearchResult[] {
  return results.sort((a, b) => {
    const direction = sortBy.endsWith("desc") ? -1 : 1;
    const primary = sortBy.startsWith("distance")
      ? compareOptionalNumber(a.distanceKm, b.distanceKm, direction)
      : compareTimeValues(
          a.showtime.startsAt,
          b.showtime.startsAt,
          direction,
        );
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

function getDistanceFromOrigin(
  origin: Coordinates | undefined,
  theatre: Theatre,
): number | undefined {
  return theatre.latitude !== undefined &&
    theatre.longitude !== undefined &&
    origin
    ? distanceKm(origin, {
        latitude: theatre.latitude,
        longitude: theatre.longitude,
      })
    : undefined;
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

function toTheatre(theatre: CineplexTheatre): Theatre {
  const latitude = theatre.location?.geoLocation?.latitude;
  const longitude = theatre.location?.geoLocation?.longitude;

  return {
    id: `cineplex-${theatre.theatreId}`,
    provider: "cineplex",
    providerTheatreId: String(theatre.theatreId),
    name: theatre.theatreName,
    address: theatre.location?.address,
    city: theatre.location?.city ?? "",
    province: theatre.location?.provinceCode ?? "",
    postalCode: theatre.location?.postalCode,
    latitude,
    longitude,
    timeZone: getTimeZone(latitude, longitude),
  };
}

function getTimeZone(
  latitude: number | undefined,
  longitude: number | undefined,
): string | undefined {
  if (latitude === undefined || longitude === undefined) {
    return undefined;
  }

  try {
    return tzLookup(latitude, longitude);
  } catch {
    return undefined;
  }
}

function buildPublicSeatMapUrl(
  theatreId: string,
  session: CineplexSession,
  dbox: boolean,
): string {
  const publicSeatMapUrl = normalizePublicSeatMapUrl(session.seatMapUrl);

  if (publicSeatMapUrl) {
    return publicSeatMapUrl;
  }

  const url = new URL("https://www.cineplex.com/en-Mobile/ticketing/preview");
  url.searchParams.set("theatreId", theatreId);
  url.searchParams.set("showtimeId", String(session.vistaSessionId));
  url.searchParams.set("dbox", dbox ? "True" : "False");
  return url.toString();
}

export function normalizePublicPurchaseUrl(
  rawUrl?: string,
): string | undefined {
  if (!rawUrl) {
    return undefined;
  }

  try {
    const url = new URL(rawUrl);
    const isCineplexDeeplink =
      url.protocol === "https:" &&
      url.hostname.toLowerCase() === "apis.cineplex.com" &&
      url.pathname.toLowerCase() === "/prod/cpx/theatrical/deeplink" &&
      ["s", "a", "l", "m"].every((key) => Boolean(url.searchParams.get(key)));

    return isCineplexDeeplink ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function normalizePublicSeatMapUrl(rawUrl?: string): string | undefined {
  if (!rawUrl) {
    return undefined;
  }

  try {
    const url = new URL(rawUrl);
    const hostname = url.hostname.toLowerCase();
    const isCineplexPreview =
      url.protocol === "https:" &&
      (hostname === "www.cineplex.com" || hostname === "cineplex.com") &&
      url.pathname.toLowerCase().endsWith("/ticketing/preview") &&
      Boolean(url.searchParams.get("theatreId")) &&
      Boolean(url.searchParams.get("showtimeId"));

    return isCineplexPreview ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function matchesTheatreText(theatre: Theatre, text: string): boolean {
  const compactText = text.replace(/\s+/g, "");
  const searchableFields = [
    theatre.name,
    theatre.city,
    theatre.province,
    theatre.address,
  ].filter((value): value is string => Boolean(value));

  return (
    searchableFields.some((value) => value.toLowerCase().includes(text)) ||
    Boolean(
      theatre.postalCode
        ?.toLowerCase()
        .replace(/\s+/g, "")
        .includes(compactText),
    )
  );
}

function toRawSeats(
  layout: SeatLayout,
  availability: SeatAvailability,
): RawSeat[] {
  const availabilityBySeat = availability.seatAvailabilities ?? {};
  return flattenSeats(layout).map((seat) => ({
    type: seat.type,
    status: availabilityBySeat[seat.id],
  }));
}

function flattenSeats(
  layout: SeatLayout,
): Array<{ id: string; type?: string }> {
  return [layout.standardSeats, layout.dboxSeats, layout.balconySeats].flatMap(
    (area) => (area?.rows ?? []).flatMap((row) => row.seats ?? []),
  );
}
