import { addDays, isValidDateInput, normalizeEndDate } from "./date-range";
import {
  parseShowtimeExperienceTypes,
  type ShowtimeExperienceType,
} from "./experience-types";
import type { SortOption } from "./types";

export type SearchFilters = {
  onlyZeroSold: boolean;
  maxFiveSold: boolean;
  startsInNextTwoHours: boolean;
  nonVipOnly: boolean;
  accessibleAvailable: boolean;
};

export type SearchState = {
  location: string;
  date: string;
  endDate: string;
  radiusKm: string;
  latitude?: number;
  longitude?: number;
  movieTitle: string;
  experienceTypes: ShowtimeExperienceType[];
  sortBy: SortOption;
  filters: SearchFilters;
};

type StoredSearchState = Partial<SearchState>;

const defaultFilters: SearchFilters = {
  onlyZeroSold: false,
  maxFiveSold: false,
  startsInNextTwoHours: false,
  nonVipOnly: false,
  accessibleAvailable: false,
};

const DEFAULT_SORT_BY: SortOption = "distance-asc";

export function makeDefaultSearchState(
  today = getLocalDateInputValue(),
): SearchState {
  return {
    location: "",
    date: today,
    endDate: addDays(today, 1),
    radiusKm: "25",
    movieTitle: "",
    experienceTypes: [],
    sortBy: DEFAULT_SORT_BY,
    filters: { ...defaultFilters },
  };
}

export function getEffectiveFilters(
  state: SearchState,
  today = getLocalDateInputValue(),
): SearchFilters {
  return {
    ...state.filters,
    startsInNextTwoHours:
      state.date === today &&
      state.endDate === today &&
      state.filters.startsInNextTwoHours,
  };
}

export function buildSearchParams(state: SearchState): URLSearchParams {
  const filters = getEffectiveFilters(state);
  const params = new URLSearchParams({
    location: state.location,
    date: state.date,
    endDate: state.endDate,
    radiusKm: state.radiusKm,
    sortBy: state.sortBy,
  });

  for (const [key, enabled] of Object.entries(filters)) {
    if (enabled) {
      params.set(key, "true");
    }
  }

  if (state.movieTitle.trim()) {
    params.set("movieTitle", state.movieTitle.trim());
  }

  if (state.experienceTypes.length) {
    params.set("experienceTypes", state.experienceTypes.join(","));
  }

  if (state.latitude !== undefined && state.longitude !== undefined) {
    params.set("latitude", String(state.latitude));
    params.set("longitude", String(state.longitude));
  }

  return params;
}

export function normalizeSearchState(
  state: StoredSearchState,
  today = getLocalDateInputValue(),
): SearchState {
  const defaults = makeDefaultSearchState(today);
  const date =
    state.date && isValidDateInput(state.date) ? state.date : defaults.date;
  const endDate = normalizeEndDate(date, state.endDate);
  const coordinates = normalizeCoordinates(state.latitude, state.longitude);

  return {
    location: state.location || defaults.location,
    date,
    endDate,
    radiusKm: state.radiusKm || defaults.radiusKm,
    ...coordinates,
    movieTitle: state.movieTitle || "",
    experienceTypes: parseShowtimeExperienceTypes(state.experienceTypes ?? []),
    sortBy: parseSortOption(state.sortBy) ?? defaults.sortBy,
    filters: {
      ...defaults.filters,
      ...state.filters,
      startsInNextTwoHours:
        date === today &&
        endDate === today &&
        Boolean(state.filters?.startsInNextTwoHours),
    },
  };
}

export function readSearchStateFromUrl(
  search: string,
): StoredSearchState | undefined {
  if (!search) {
    return undefined;
  }

  const params = new URLSearchParams(search);
  const location = params.get("location");
  const date = params.get("date");

  if (!location || !date) {
    return undefined;
  }

  const endDate = normalizeEndDate(date, params.get("endDate") ?? date);
  const coordinates = normalizeCoordinates(
    parseOptionalNumber(params.get("latitude")),
    parseOptionalNumber(params.get("longitude")),
  );

  return {
    location,
    date,
    endDate,
    radiusKm: params.get("radiusKm") ?? "25",
    ...coordinates,
    movieTitle: params.get("movieTitle") ?? "",
    experienceTypes: parseShowtimeExperienceTypes(
      params.getAll("experienceTypes"),
    ),
    sortBy: parseSortOption(params.get("sortBy")) ?? DEFAULT_SORT_BY,
    filters: {
      onlyZeroSold: params.get("onlyZeroSold") === "true",
      maxFiveSold: params.get("maxFiveSold") === "true",
      startsInNextTwoHours: params.get("startsInNextTwoHours") === "true",
      nonVipOnly: params.get("nonVipOnly") === "true",
      accessibleAvailable: params.get("accessibleAvailable") === "true",
    },
  };
}

function parseSortOption(value: unknown): SortOption | undefined {
  return value === "distance-asc" ||
    value === "distance-desc" ||
    value === "time-asc" ||
    value === "time-desc"
    ? value
    : undefined;
}

export function getLocalDateInputValue(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseOptionalNumber(value: string | null): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizeCoordinates(
  latitude: number | undefined,
  longitude: number | undefined,
): Pick<SearchState, "latitude" | "longitude"> {
  return latitude !== undefined &&
    longitude !== undefined &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180
    ? { latitude, longitude }
    : {};
}
