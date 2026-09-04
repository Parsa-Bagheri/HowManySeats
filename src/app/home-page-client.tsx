"use client";

import {
  ArrowDownUp,
  CalendarDays,
  ChevronDown,
  Clock,
  ExternalLink,
  Filter,
  MapPin,
  Radar,
  Search,
  SlidersHorizontal,
  Sparkles,
  X,
} from "lucide-react";
import {
  type Dispatch,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  type SetStateAction,
  memo,
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import AddressField, { type LocationCoordinates } from "@/app/address-field";
import {
  searchBrowserCinemas,
  suggestBrowserMovieTitles,
} from "@/lib/browser-cinema-search";
import {
  filterAndSortSearchResults,
  matchesCandidateFilters,
} from "@/lib/client-search-results";
import {
  addDays,
  formatDateRangeLabel,
  normalizeEndDate,
} from "@/lib/date-range";
import {
  SHOWTIME_EXPERIENCE_TYPES,
  type ShowtimeExperienceType,
} from "@/lib/experience-types";
import {
  buildSearchParams,
  getEffectiveFilters,
  getLocalDateInputValue,
  getSearchScopeKey,
  makeDefaultSearchState,
  normalizeSearchState,
  readSearchStateFromUrl,
  type SearchFilters,
  type SearchState,
} from "@/lib/search-state";
import { fetchLandmarkSeatSnapshot } from "@/lib/landmark-seats";
import type {
  CinemaProvider,
  MovieSuggestion,
  SearchCandidate,
  SearchResult,
  SeatSnapshot,
  SortOption,
  Theatre,
} from "@/lib/types";
import {
  UI_MODE_COOKIE_NAME,
  type UiMode,
} from "@/lib/ui-mode";

type HomePageClientProps = {
  initialToday: string;
  initialUiMode: UiMode;
};

type SearchFormProps = {
  date: string;
  endDate: string;
  experienceTypes: ShowtimeExperienceType[];
  filters: SearchFilters;
  loading: boolean;
  location: string;
  movieTitle: string;
  movieSuggestions: MovieSuggestion[];
  movieSuggestionsLoading: boolean;
  movieSuggestionsOpen: boolean;
  onMovieTitleBlur: () => void;
  onMovieTitleFocus: () => void;
  onMovieSuggestionSelect: (title: string) => void;
  onMovieSuggestionsClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  radiusKm: string;
  selectedDateIsToday: boolean;
  setFilters: Dispatch<SetStateAction<SearchFilters>>;
  setExperienceTypes: Dispatch<SetStateAction<ShowtimeExperienceType[]>>;
  setLocation: (value: string, coordinates?: LocationCoordinates) => void;
  setMovieTitle: (value: string) => void;
  setRadiusKm: (value: string) => void;
  setSortBy: (value: SortOption) => void;
  sortBy: SortOption;
  today: string;
  updateEndDate: (value: string) => void;
  updateStartDate: (value: string) => void;
};

type SearchViewProps = {
  activeFilterCount: number;
  error: string | undefined;
  form: SearchFormProps;
  hasSearched: boolean;
  onDismissThemePrompt: () => void;
  resultState: SearchState;
  results: SearchResult[];
  searchProgress: SearchProgress;
  setUiMode: (mode: UiMode) => void;
  showThemePrompt: boolean;
  uiMode: UiMode;
  warning: string | undefined;
};

type SearchProgress = {
  checked: number;
  total: number;
};

type PendingHydration = {
  searchId: number;
  state: SearchState;
};

type FilterOption = {
  key: keyof SearchFilters;
  label: string;
  todayOnly?: boolean;
};

const FILTER_OPTIONS: FilterOption[] = [
  { key: "onlyZeroSold", label: "0 seats sold" },
  { key: "maxFiveSold", label: "5 or fewer seats sold" },
  {
    key: "startsInNextTwoHours",
    label: "Starts in the next 2 hours",
    todayOnly: true,
  },
  { key: "nonVipOnly", label: "Non-VIP showtimes only" },
  { key: "accessibleAvailable", label: "Accessible seating available" },
];

const SORT_LABELS = {
  "distance-asc": "Nearest distance first",
  "distance-desc": "Farthest distance first",
  "time-asc": "Earliest time first",
  "time-desc": "Latest time first",
} satisfies Record<SortOption, string>;

const THEME_PROMPT_STORAGE_KEY = "how-many-seats-theme-prompt-seen";
const UI_MODE_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;
const FUN_RESULT_BATCH_SIZE = 12;
const SEAT_HYDRATION_BATCH_SIZE = 40;
const LANDMARK_SEAT_CHECK_CONCURRENCY = 6;

const funInputClass =
  "focus-ring h-12 w-full border-4 border-black bg-[#fff8df] px-3 text-base font-black text-black shadow-[6px_6px_0_#111111] transition placeholder:text-zinc-500 focus:-translate-y-0.5 focus:shadow-[8px_8px_0_#111111]";
const funPanelShadow = "shadow-[12px_12px_0_#111111]";
const funCardShadow = "shadow-[10px_10px_0_#111111]";

export default function HomePageClient({
  initialToday,
  initialUiMode,
}: HomePageClientProps) {
  const [today, setToday] = useState(initialToday);
  const [searchState, setSearchState] = useState<SearchState>(() =>
    makeDefaultSearchState(initialToday),
  );
  const [movieSuggestions, setMovieSuggestions] = useState<MovieSuggestion[]>(
    [],
  );
  const [movieSuggestionsLoading, setMovieSuggestionsLoading] = useState(false);
  const [movieSuggestionsOpen, setMovieSuggestionsOpen] = useState(false);
  const [loadedResults, setLoadedResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchProgress, setSearchProgress] = useState<SearchProgress>({
    checked: 0,
    total: 0,
  });
  const [error, setError] = useState<string | undefined>();
  const [warning, setWarning] = useState<string | undefined>();
  const [hasSearched, setHasSearched] = useState(false);
  const [searchedState, setSearchedState] = useState<SearchState | undefined>(
    undefined,
  );
  const [uiMode, setUiModeState] = useState<UiMode>(initialUiMode);
  const [showThemePrompt, setShowThemePrompt] = useState(false);
  const loadedSavedState = useRef(false);
  const movieTitleFocused = useRef(false);
  const skipNextMovieSuggestionFetch = useRef(false);
  const activeSearchController = useRef<AbortController | undefined>(undefined);
  const activeSearchId = useRef(0);
  const discoveryInFlight = useRef(false);
  const activeHydrationController = useRef<AbortController | undefined>(
    undefined,
  );
  const hydrationRunning = useRef(false);
  const pendingHydration = useRef<PendingHydration | undefined>(undefined);
  const appliedSearchState = useRef<SearchState | undefined>(undefined);
  const discoveredScopeKey = useRef<string | undefined>(undefined);
  const discoveredCandidates = useRef<SearchCandidate[]>([]);
  const unavailableProviders = useRef<CinemaProvider[]>([]);
  const hadDiscoveryFailures = useRef(false);
  const snapshotResults = useRef(new Map<string, SearchResult>());
  const attemptedSeatIds = useRef(new Set<string>());
  const failedSeatIds = useRef(new Set<string>());
  const lastHydrationSignature = useRef<string | undefined>(undefined);
  const latestSearchState = useRef(searchState);

  latestSearchState.current = searchState;

  const {
    location,
    date,
    endDate,
    radiusKm,
    latitude,
    longitude,
    movieTitle,
    experienceTypes,
    sortBy,
    filters,
  } = searchState;
  const resultState = getResultSearchState(searchedState, searchState);
  const resultViewSignature = getResultViewSignature(resultState);
  const hydrationSignature = getHydrationSignature(resultState);
  const selectedDateIsToday = date === today && endDate === today;
  const activeFilterCount =
    Object.values(getEffectiveFilters(resultState, today)).filter(Boolean)
      .length + resultState.experienceTypes.length;
  const results = useMemo(
    () =>
      filterAndSortSearchResults(
        loadedResults,
        resultState,
        new Date(),
        today,
      ),
    [loadedResults, resultState, today],
  );

  const setUiMode = useCallback((mode: UiMode) => {
    rememberUiModePreference(mode);
    startTransition(() => setUiModeState(mode));
  }, []);

  const dismissThemePrompt = useCallback(() => {
    setShowThemePrompt(false);
  }, []);

  const setFilters = useCallback(
    (action: SetStateAction<SearchFilters>) => {
      setSearchState((current) => ({
        ...current,
        filters: resolveStateAction(action, current.filters),
      }));
    },
    [],
  );

  const setExperienceTypes = useCallback(
    (action: SetStateAction<ShowtimeExperienceType[]>) => {
      setSearchState((current) => ({
        ...current,
        experienceTypes: resolveStateAction(action, current.experienceTypes),
      }));
    },
    [],
  );

  const setRadiusKm = useCallback((radiusKm: string) => {
    setSearchState((current) => ({ ...current, radiusKm }));
  }, []);

  const setSortBy = useCallback((sortBy: SortOption) => {
    setSearchState((current) => ({ ...current, sortBy }));
  }, []);

  const updateLocation = useCallback(
    (value: string, coordinates?: LocationCoordinates) => {
      setSearchState((current) => ({
        ...current,
        location: value,
        latitude: coordinates?.latitude,
        longitude: coordinates?.longitude,
      }));
    },
    [],
  );

  const updateMovieTitle = useCallback((value: string) => {
    setSearchState((current) => ({ ...current, movieTitle: value }));
    setMovieSuggestionsOpen(
      movieTitleFocused.current && value.trim().length >= 2,
    );
  }, []);

  const onMovieTitleFocus = useCallback(() => {
    movieTitleFocused.current = true;
    setMovieSuggestionsOpen(movieSuggestions.length > 0);
  }, [movieSuggestions.length]);

  const onMovieTitleBlur = useCallback(() => {
    movieTitleFocused.current = false;
    window.setTimeout(() => setMovieSuggestionsOpen(false), 120);
  }, []);

  const onMovieSuggestionSelect = useCallback((title: string) => {
    skipNextMovieSuggestionFetch.current = true;
    setSearchState((current) => ({ ...current, movieTitle: title }));
    setMovieSuggestions([]);
    setMovieSuggestionsOpen(false);
    setMovieSuggestionsLoading(false);
  }, []);

  const hydrateEligibleCandidates = useCallback(
    async (state: SearchState, searchId: number) => {
      pendingHydration.current = { searchId, state };

      if (hydrationRunning.current) {
        return;
      }

      hydrationRunning.current = true;

      try {
        while (pendingHydration.current) {
          const request = pendingHydration.current;
          pendingHydration.current = undefined;

          if (request.searchId !== activeSearchId.current) {
            continue;
          }

          const controller = activeHydrationController.current;

          if (!controller || controller.signal.aborted) {
            continue;
          }

          const now = new Date();
          const localToday = getLocalDateInputValue();
          const eligibleCandidates = discoveredCandidates.current.filter(
            (candidate) =>
              matchesCandidateFilters(
                candidate,
                request.state,
                now,
                localToday,
              ),
          );
          const missingCandidates = eligibleCandidates.filter(
            (candidate) => !attemptedSeatIds.current.has(candidate.showtime.id),
          );
          const previouslyChecked =
            eligibleCandidates.length - missingCandidates.length;

          setSearchProgress({
            checked: previouslyChecked,
            total: eligibleCandidates.length,
          });

          if (missingCandidates.length === 0) {
            setWarning(
              buildSearchWarning(
                unavailableProviders.current,
                hadDiscoveryFailures.current,
                eligibleCandidates.some((candidate) =>
                  failedSeatIds.current.has(candidate.showtime.id),
                ),
              ),
            );
            continue;
          }

          setLoading(true);

          for (
            let offset = 0;
            offset < missingCandidates.length;
            offset += SEAT_HYDRATION_BATCH_SIZE
          ) {
            const batch = missingCandidates.slice(
              offset,
              offset + SEAT_HYDRATION_BATCH_SIZE,
            );
            const loaded = await loadSeatSnapshotBatch(
              batch,
              controller.signal,
            );

            if (
              controller.signal.aborted ||
              request.searchId !== activeSearchId.current
            ) {
              break;
            }

            const loadedIds = new Set(
              loaded.results.map((result) => result.showtime.id),
            );

            for (const candidate of batch) {
              if (loadedIds.has(candidate.showtime.id)) {
                failedSeatIds.current.delete(candidate.showtime.id);
              } else if (loaded.hadFailures) {
                failedSeatIds.current.add(candidate.showtime.id);
              }
            }

            for (const result of loaded.results) {
              attemptedSeatIds.current.add(result.showtime.id);
              snapshotResults.current.set(result.showtime.id, result);
            }

            setLoadedResults(Array.from(snapshotResults.current.values()));
            setSearchProgress({
              checked: Math.min(
                previouslyChecked + offset + batch.length,
                eligibleCandidates.length,
              ),
              total: eligibleCandidates.length,
            });
            setWarning(
              buildSearchWarning(
                unavailableProviders.current,
                hadDiscoveryFailures.current,
                eligibleCandidates.some((candidate) =>
                  failedSeatIds.current.has(candidate.showtime.id),
                ),
              ),
            );

            const queuedHydration = pendingHydration.current as
              | PendingHydration
              | undefined;

            if (
              queuedHydration &&
              getHydrationSignature(queuedHydration.state) !==
                getHydrationSignature(request.state)
            ) {
              break;
            }
          }
        }
      } finally {
        hydrationRunning.current = false;

        if (!discoveryInFlight.current) {
          setLoading(false);
        }
      }
    },
    [],
  );

  const executeSearch = useCallback(async (state: SearchState) => {
    const scopeKey = getSearchScopeKey(state);

    if (
      scopeKey === discoveredScopeKey.current &&
      unavailableProviders.current.length === 0 &&
      !hadDiscoveryFailures.current
    ) {
      appliedSearchState.current = state;
      setSearchedState(state);
      setError(undefined);
      setHasSearched(true);
      window.history.replaceState(
        null,
        "",
        `/?${buildSearchParams(state).toString()}`,
      );
      lastHydrationSignature.current = getHydrationSignature(state);
      await hydrateEligibleCandidates(state, activeSearchId.current);
      return;
    }

    const requestId = activeSearchId.current + 1;
    const controller = new AbortController();

    activeSearchId.current = requestId;
    activeSearchController.current?.abort();
    activeHydrationController.current?.abort();
    activeSearchController.current = controller;
    activeHydrationController.current = new AbortController();
    discoveryInFlight.current = true;
    pendingHydration.current = undefined;
    appliedSearchState.current = state;
    setSearchedState(state);
    discoveredScopeKey.current = undefined;
    discoveredCandidates.current = [];
    unavailableProviders.current = [];
    hadDiscoveryFailures.current = false;
    snapshotResults.current = new Map();
    attemptedSeatIds.current = new Set();
    failedSeatIds.current = new Set();
    lastHydrationSignature.current = undefined;
    setLoading(true);
    setHasSearched(false);
    setSearchProgress({ checked: 0, total: 0 });
    setError(undefined);
    setWarning(undefined);
    setLoadedResults([]);

    const params = buildSearchParams(state);
    window.history.replaceState(null, "", `/?${params.toString()}`);

    try {
      const body = await searchBrowserCinemas(state, controller.signal);

      if (controller.signal.aborted || requestId !== activeSearchId.current) {
        return;
      }

      discoveredCandidates.current = interleaveProviderCandidates(body.results);
      discoveredScopeKey.current = scopeKey;
      unavailableProviders.current = body.unavailableProviders;
      hadDiscoveryFailures.current = body.partialResults;
      setWarning(
        buildSearchWarning(
          body.unavailableProviders,
          body.partialResults,
          false,
        ),
      );
      setHasSearched(true);

      const hydrationState = getResultSearchState(
        state,
        latestSearchState.current,
      );
      lastHydrationSignature.current = getHydrationSignature(hydrationState);
      discoveryInFlight.current = false;
      await hydrateEligibleCandidates(hydrationState, requestId);
    } catch {
      if (!controller.signal.aborted && requestId === activeSearchId.current) {
        setLoadedResults([]);
        setError(
          "Search is temporarily unavailable. Check your connection and try again.",
        );
      }
    } finally {
      if (requestId === activeSearchId.current) {
        discoveryInFlight.current = false;
      }

      if (
        requestId === activeSearchId.current &&
        discoveredCandidates.current.length === 0
      ) {
        setLoading(false);
        setHasSearched(true);
      }
    }
  }, [hydrateEligibleCandidates]);

  const onMovieSuggestionsClose = useCallback(() => {
    setMovieSuggestionsOpen(false);
  }, []);

  useEffect(() => {
    return () => {
      activeSearchController.current?.abort();
      activeHydrationController.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (!hasSearched || !appliedSearchState.current) {
      return;
    }

    const current = getResultSearchState(
      appliedSearchState.current,
      latestSearchState.current,
    );
    const params = buildSearchParams({
      ...appliedSearchState.current,
      experienceTypes: current.experienceTypes,
      filters: current.filters,
      movieTitle: current.movieTitle,
      sortBy: current.sortBy,
    });
    window.history.replaceState(null, "", `/?${params.toString()}`);

    if (lastHydrationSignature.current === hydrationSignature) {
      return;
    }

    const scheduledSearchId = activeSearchId.current;
    const scheduledHydrationSignature = hydrationSignature;
    const timeout = window.setTimeout(() => {
      if (
        scheduledSearchId !== activeSearchId.current ||
        scheduledHydrationSignature !==
          getHydrationSignature(
            getResultSearchState(
              appliedSearchState.current,
              latestSearchState.current,
            ),
          ) ||
        lastHydrationSignature.current === scheduledHydrationSignature
      ) {
        return;
      }

      lastHydrationSignature.current = scheduledHydrationSignature;
      void hydrateEligibleCandidates(
        getResultSearchState(
          appliedSearchState.current,
          latestSearchState.current,
        ),
        activeSearchId.current,
      );
    }, 200);

    return () => window.clearTimeout(timeout);
  }, [
    hasSearched,
    hydrateEligibleCandidates,
    hydrationSignature,
    resultViewSignature,
  ]);

  useEffect(() => {
    try {
      if (window.localStorage.getItem(THEME_PROMPT_STORAGE_KEY) === "true") {
        return;
      }

      window.localStorage.setItem(THEME_PROMPT_STORAGE_KEY, "true");
    } catch {
      // Continue without persistence when browser storage is unavailable.
    }

    setShowThemePrompt(true);
  }, []);

  useEffect(() => {
    if (loadedSavedState.current) {
      return;
    }

    loadedSavedState.current = true;
    const localToday = getLocalDateInputValue();
    setToday(localToday);
    const saved = readSearchStateFromUrl(window.location.search);

    if (!saved) {
      if (localToday !== initialToday) {
        setSearchState((current) => ({
          ...current,
          date: localToday,
          endDate: addDays(localToday, 1),
        }));
      }
      return;
    }

    setSearchState(normalizeSearchState(saved, localToday));
  }, [initialToday]);

  useEffect(() => {
    const query = movieTitle.trim();

    if (skipNextMovieSuggestionFetch.current) {
      skipNextMovieSuggestionFetch.current = false;
      setMovieSuggestionsLoading(false);
      return;
    }

    if (query.length < 2 || !location.trim() || !date) {
      setMovieSuggestions([]);
      setMovieSuggestionsOpen(false);
      setMovieSuggestionsLoading(false);
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setMovieSuggestionsLoading(true);

      try {
        const suggestions = await suggestBrowserMovieTitles(
          latestSearchState.current,
          query,
          controller.signal,
        );

        if (controller.signal.aborted) {
          return;
        }

        setMovieSuggestions(suggestions);
        setMovieSuggestionsOpen(
          movieTitleFocused.current && suggestions.length > 0,
        );
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }

        setMovieSuggestions([]);
        setMovieSuggestionsOpen(false);
      } finally {
        if (!controller.signal.aborted) {
          setMovieSuggestionsLoading(false);
        }
      }
    }, 300);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [date, endDate, latitude, location, longitude, movieTitle, radiusKm]);

  const onSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      await executeSearch(searchState);
    },
    [executeSearch, searchState],
  );

  const updateStartDate = useCallback((value: string) => {
    setSearchState((current) => {
      const nextEndDate = normalizeEndDate(value, current.endDate);
      const preserveTimeFilter = value === today && nextEndDate === today;

      return {
        ...current,
        date: value,
        endDate: nextEndDate,
        filters: preserveTimeFilter
          ? current.filters
          : { ...current.filters, startsInNextTwoHours: false },
      };
    });
  }, [today]);

  const updateEndDate = useCallback((value: string) => {
    setSearchState((current) => {
      const nextEndDate = normalizeEndDate(current.date, value);
      const preserveTimeFilter =
        current.date === today && nextEndDate === today;

      return {
        ...current,
        endDate: nextEndDate,
        filters: preserveTimeFilter
          ? current.filters
          : { ...current.filters, startsInNextTwoHours: false },
      };
    });
  }, [today]);

  const form: SearchFormProps = {
    date,
    endDate,
    experienceTypes,
    filters,
    loading,
    location,
    movieTitle,
    movieSuggestions,
    movieSuggestionsLoading,
    movieSuggestionsOpen,
    onMovieTitleBlur,
    onMovieTitleFocus,
    onMovieSuggestionSelect,
    onMovieSuggestionsClose,
    onSubmit,
    radiusKm,
    selectedDateIsToday,
    setFilters,
    setExperienceTypes,
    setLocation: updateLocation,
    setMovieTitle: updateMovieTitle,
    setRadiusKm,
    setSortBy,
    sortBy,
    today,
    updateEndDate,
    updateStartDate,
  };
  const viewProps: SearchViewProps = {
    activeFilterCount,
    error,
    form,
    hasSearched,
    onDismissThemePrompt: dismissThemePrompt,
    resultState,
    results,
    searchProgress,
    setUiMode,
    showThemePrompt,
    uiMode,
    warning,
  };

  return uiMode === "fun" ? (
    <FunHomeView {...viewProps} />
  ) : (
    <CleanHomeView {...viewProps} />
  );
}

function rememberUiModePreference(mode: UiMode) {
  document.cookie = `${UI_MODE_COOKIE_NAME}=${mode}; Path=/; Max-Age=${UI_MODE_COOKIE_MAX_AGE_SECONDS}; SameSite=Lax`;
}

async function loadSeatSnapshotBatch(
  candidates: SearchCandidate[],
  signal: AbortSignal,
): Promise<{
  hadFailures: boolean;
  results: SearchResult[];
}> {
  const cineplexCandidates = candidates.filter(
    (candidate) => candidate.theatre.provider === "cineplex",
  );
  const landmarkCandidates = candidates.filter(
    (candidate) => candidate.theatre.provider === "landmark",
  );
  const [cineplex, landmark] = await Promise.all([
    loadCineplexSeatSnapshots(cineplexCandidates, signal),
    loadLandmarkSeatSnapshots(landmarkCandidates, signal),
  ]);
  const resultsById = new Map(
    [...cineplex.results, ...landmark.results].map((result) => [
      result.showtime.id,
      result,
    ]),
  );
  const results = candidates
    .map((candidate) => resultsById.get(candidate.showtime.id))
    .filter((result): result is SearchResult => Boolean(result));

  return {
    hadFailures: cineplex.hadFailures || landmark.hadFailures,
    results,
  };
}

async function loadCineplexSeatSnapshots(
  candidates: SearchCandidate[],
  signal: AbortSignal,
): Promise<{ hadFailures: boolean; results: SearchResult[] }> {
  if (candidates.length === 0 || signal.aborted) {
    return { hadFailures: false, results: [] };
  }

  try {
    const response = await fetch("/api/cineplex-seats", {
      body: JSON.stringify({
        requests: candidates.map((candidate) => ({
          resultId: candidate.showtime.id,
          showtimeId: candidate.showtime.providerShowtimeId,
          theatreId: candidate.theatre.providerTheatreId,
        })),
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
      signal,
    });
    const body = (await response.json()) as
      | {
          failedResultIds: string[];
          results: Array<{ resultId: string; snapshot: SeatSnapshot }>;
        }
      | { error: string };

    if (!response.ok || !("results" in body)) {
      return { hadFailures: true, results: [] };
    }

    const snapshots = new Map(
      body.results.map((result) => [result.resultId, result.snapshot]),
    );
    const results = candidates.flatMap((candidate) => {
      const snapshot = snapshots.get(candidate.showtime.id);
      return snapshot ? [{ ...candidate, snapshot }] : [];
    });

    return {
      hadFailures: body.failedResultIds.length > 0,
      results,
    };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return { hadFailures: false, results: [] };
    }

    return { hadFailures: true, results: [] };
  }
}

async function loadLandmarkSeatSnapshots(
  candidates: SearchCandidate[],
  signal: AbortSignal,
): Promise<{ hadFailures: boolean; results: SearchResult[] }> {
  const results: SearchResult[] = [];
  let hadFailures = false;

  for (
    let offset = 0;
    offset < candidates.length;
    offset += LANDMARK_SEAT_CHECK_CONCURRENCY
  ) {
    if (signal.aborted) {
      return { hadFailures, results: [] };
    }

    const batch = candidates.slice(
      offset,
      offset + LANDMARK_SEAT_CHECK_CONCURRENCY,
    );

    await Promise.all(
      batch.map(async (candidate) => {
        try {
          const snapshot = await fetchLandmarkSeatSnapshot(
            candidate.theatre.providerTheatreId,
            candidate.showtime.providerShowtimeId,
            signal,
          );
          results.push({ ...candidate, snapshot });
        } catch {
          if (!signal.aborted) {
            hadFailures = true;
          }
        }
      }),
    );
  }

  return { hadFailures, results };
}

function buildSearchWarning(
  unavailableProviders: CinemaProvider[],
  hadDiscoveryFailures: boolean,
  hadSeatFailures: boolean,
): string | undefined {
  const messages = unavailableProviders.map(
    (provider) =>
      `${cinemaProviderLabel(provider)} results are temporarily unavailable.`,
  );

  if (hadDiscoveryFailures) {
    messages.push("Some showtimes couldn't be loaded.");
  }

  if (hadSeatFailures) {
    messages.push("Some seat counts couldn't be loaded.");
  }

  return messages.length > 0 ? messages.join(" ") : undefined;
}

function interleaveProviderCandidates(
  candidates: SearchCandidate[],
): SearchCandidate[] {
  const groups = new Map<CinemaProvider, SearchCandidate[]>([
    ["cineplex", []],
    ["landmark", []],
  ]);

  for (const candidate of candidates) {
    groups.get(candidate.theatre.provider)?.push(candidate);
  }

  const interleaved: SearchCandidate[] = [];
  const longestGroup = Math.max(
    0,
    ...Array.from(groups.values(), (group) => group.length),
  );

  for (let index = 0; index < longestGroup; index += 1) {
    for (const provider of ["cineplex", "landmark"] as const) {
      const candidate = groups.get(provider)?.[index];

      if (candidate) {
        interleaved.push(candidate);
      }
    }
  }

  return interleaved;
}

function CleanHomeView(props: SearchViewProps) {
  const {
    activeFilterCount,
    error,
    form,
    hasSearched,
    resultState,
    results,
    searchProgress,
    setUiMode,
    showThemePrompt,
    uiMode,
    onDismissThemePrompt,
    warning,
  } = props;
  const { loading } = form;
  return (
    <main className="flex min-h-screen flex-col bg-[#050505] px-4 py-5 text-neutral-100 sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-5">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold leading-tight text-white">
              <span className="block">How Many</span>{" "}
              <span className="block">Seats Left?</span>
            </h1>
          </div>
          <div className="shrink-0 sm:ml-auto">
            <ModeSwitchNudge
              uiMode={uiMode}
              show={showThemePrompt}
              onChange={setUiMode}
              onDismiss={onDismissThemePrompt}
            />
          </div>
        </header>

        <div className="grid w-full flex-1 gap-5 lg:grid-cols-[380px_1fr]">
          <section className="rounded-lg border border-neutral-800 bg-[#111111] p-4 shadow-[0_18px_70px_rgba(0,0,0,0.45)]">
            <SearchForm mode="clean" {...form} />
          </section>

          <section className="grid content-start gap-3">
            <div className="rounded-lg border border-neutral-800 bg-[#111111] p-4 shadow-[0_18px_70px_rgba(0,0,0,0.35)]">
              <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                  <p className="text-sm text-neutral-400">Results</p>
                  <p className="mt-1 text-3xl font-semibold text-white">
                    {resultCount(results, loading)}
                  </p>
                </div>
                <div className="text-right text-sm text-neutral-400">
                  <p>
                    {resultState.location.trim() || "No location"} -{" "}
                    {formatDateRangeLabel(
                      resultState.date,
                      resultState.endDate,
                    )}
                  </p>
                  <p>
                    {activeFilterCount} active filter
                    {activeFilterCount === 1 ? "" : "s"}
                  </p>
                  <p>{sortLabel(resultState.sortBy)}</p>
                </div>
              </div>
            </div>

            {error ? (
              <div
                className="rounded-md border border-red-500/40 bg-red-950/40 p-3 text-sm text-red-100"
                role="alert"
              >
                {error}
              </div>
            ) : null}

            {warning ? (
              <div
                className="rounded-md border border-amber-400/40 bg-amber-950/30 p-3 text-sm text-amber-100"
                role="status"
              >
                {warning}
              </div>
            ) : null}

            {loading ? (
              <CleanSearchLoader progress={searchProgress} />
            ) : null}

            {!loading &&
            hasSearched &&
            !error &&
            results.length === 0 ? (
              <div
                className="rounded-lg border border-neutral-800 bg-[#111111] p-5 text-sm leading-6 text-neutral-300"
                role="status"
                aria-live="polite"
              >
                No showtimes match your search. Clear a filter or choose another
                date.
              </div>
            ) : null}

            <CleanResultList results={results} />
          </section>
        </div>
      </div>
      <footer className="mx-auto mt-5 grid w-full max-w-7xl gap-1 border-t border-neutral-900 pt-4 text-center text-xs text-neutral-500">
        <p>Made in Waterloo, with love</p>
        <p>This site is not affiliated with Cineplex or Landmark Cinemas.</p>
      </footer>
    </main>
  );
}

function FunHomeView(props: SearchViewProps) {
  const {
    activeFilterCount,
    error,
    form,
    hasSearched,
    resultState,
    results,
    searchProgress,
    setUiMode,
    showThemePrompt,
    uiMode,
    onDismissThemePrompt,
    warning,
  } = props;
  const { loading } = form;
  return (
    <main className="chaos-stage min-h-screen overflow-hidden px-3 py-4 text-black sm:px-5 lg:px-8">
      <div className="relative z-10 mx-auto flex w-full max-w-[1500px] flex-col gap-5">
        <div className="flex justify-end">
          <ModeSwitchNudge
            uiMode={uiMode}
            show={showThemePrompt}
            onChange={setUiMode}
            onDismiss={onDismissThemePrompt}
          />
        </div>

        <header
          className={`relative overflow-hidden border-[6px] border-black bg-white ${funPanelShadow} sm:-rotate-[0.25deg]`}
        >
          <div className="grid gap-0 lg:grid-cols-[1fr_auto]">
            <div className="hero-blast relative border-b-[6px] border-black bg-[#ff4fa3] p-4 sm:p-7 lg:border-b-0 lg:border-r-[6px]">
              <h1 className="relative max-w-5xl text-[clamp(2.5rem,10vw,7.75rem)] font-black leading-[0.86] text-black">
                <span className="block whitespace-nowrap">
                  <span className="inline-block -rotate-1 bg-[#f7e900] px-2 shadow-[6px_6px_0_#111111]">
                    How
                  </span>{" "}
                  <span className="inline-block rotate-1 bg-white px-2 shadow-[6px_6px_0_#111111]">
                    Many
                  </span>
                </span>{" "}
                <span className="mt-3 block whitespace-nowrap">
                  <span className="ink-pop inline-block -rotate-2 px-2 text-white">
                    Seats
                  </span>{" "}
                  <span className="inline-block rotate-1 bg-[#00e676] px-2 shadow-[6px_6px_0_#111111]">
                    Left?
                  </span>
                </span>
              </h1>
            </div>
            <div className="grid min-w-0 bg-black text-white sm:grid-cols-2 lg:min-w-64 lg:grid-cols-1">
              <HeaderStat
                icon={
                  <SlidersHorizontal className="h-5 w-5" aria-hidden="true" />
                }
                label="Filters"
                value={`${activeFilterCount} active`}
                accent="bg-[#f7e900]"
              />
              <HeaderStat
                icon={<CalendarDays className="h-5 w-5" aria-hidden="true" />}
                label="Date"
                value={formatDateRangeLabel(
                  resultState.date,
                  resultState.endDate,
                )}
                accent="bg-[#00d5ff]"
              />
            </div>
          </div>
        </header>

        <div className="grid gap-5 xl:grid-cols-[430px_minmax(0,1fr)]">
          <section
            className={`border-[6px] border-black bg-[#00d5ff] p-4 ${funPanelShadow} sm:rotate-[-0.35deg] xl:sticky xl:top-5 xl:self-start`}
          >
            <div className="panic-heading mb-5 border-[6px] border-black p-3 shadow-[7px_7px_0_#111111]">
              <h2 className="text-[clamp(1.85rem,5.2vw,3.2rem)] font-black uppercase leading-none">
                See available seats at nearby showtimes
              </h2>
            </div>

            <SearchForm mode="fun" {...form} />
          </section>

          <section className="grid content-start gap-5">
            <div
              className={`relative overflow-hidden border-[6px] border-black bg-black text-white ${funPanelShadow} sm:rotate-[0.3deg]`}
            >
              <div
                className="absolute right-0 top-0 hidden h-full w-7 bg-[repeating-linear-gradient(180deg,#f7e900_0_12px,#111111_12px_24px)] lg:block"
                aria-hidden="true"
              />
              <div className="grid gap-0 lg:grid-cols-[400px_1fr]">
                <div className="relative border-b-[6px] border-black bg-[#00e676] p-5 text-black lg:border-b-0 lg:border-r-[6px]">
                  <p className="text-sm font-black uppercase tracking-[0.16em]">
                    Results
                  </p>
                  <p
                    className={`mt-1 font-black leading-none ${loading ? "text-[clamp(2.5rem,4.5vw,4rem)]" : "text-[clamp(4rem,10vw,7rem)]"}`}
                  >
                    {resultCount(results, loading)}
                  </p>
                </div>
                <div className="grid gap-4 p-5 lg:pr-12">
                  <div className="flex flex-wrap gap-3">
                    <QueryChip
                      icon={<MapPin className="h-4 w-4" aria-hidden="true" />}
                      label={resultState.location.trim() || "No location"}
                    />
                    <QueryChip
                      icon={
                        <CalendarDays className="h-4 w-4" aria-hidden="true" />
                      }
                      label={formatDateRangeLabel(
                        resultState.date,
                        resultState.endDate,
                      )}
                    />
                    <QueryChip
                      icon={<Radar className="h-4 w-4" aria-hidden="true" />}
                      label={`${resultState.radiusKm} km`}
                    />
                    <QueryChip
                      icon={<Filter className="h-4 w-4" aria-hidden="true" />}
                      label={`${activeFilterCount} active filter${activeFilterCount === 1 ? "" : "s"}`}
                    />
                    <QueryChip
                      icon={
                        <ArrowDownUp className="h-4 w-4" aria-hidden="true" />
                      }
                      label={sortLabel(resultState.sortBy)}
                    />
                  </div>
                </div>
              </div>
            </div>

            {error ? (
              <div
                className="border-[6px] border-black bg-[#ff4f4f] p-4 text-sm font-black uppercase text-black shadow-[10px_10px_0_#111111] sm:-rotate-1"
                role="alert"
              >
                {error}
              </div>
            ) : null}

            {warning ? (
              <div
                className="border-[6px] border-black bg-[#f7e900] p-4 text-sm font-black uppercase text-black shadow-[10px_10px_0_#111111] sm:rotate-1"
                role="status"
              >
                {warning}
              </div>
            ) : null}

            {loading ? <FunSearchLoader progress={searchProgress} /> : null}

            {!loading &&
            hasSearched &&
            !error &&
            results.length === 0 ? (
              <div
                className="border-[6px] border-black bg-white p-5 text-sm font-black uppercase leading-6 shadow-[10px_10px_0_#111111] sm:rotate-1"
                role="status"
                aria-live="polite"
              >
                No showtimes match your search. Clear a filter or choose another
                date.
              </div>
            ) : null}

            <FunResultList
              key={results[0]?.snapshot.checkedAt ?? "no-results"}
              results={results}
            />
          </section>
        </div>
        <footer className="grid gap-2 border-[6px] border-black bg-[#00e676] px-4 py-4 text-center text-sm font-black uppercase tracking-[0.16em] shadow-[10px_10px_0_#111111] sm:-rotate-[0.35deg]">
          <span className="inline-block justify-self-center -rotate-1 bg-white px-3 py-1 shadow-[5px_5px_0_#111111]">
            Made in Waterloo, with love
          </span>
          <span className="inline-block justify-self-center rotate-1 bg-white px-3 py-1 text-[0.7rem] shadow-[5px_5px_0_#111111]">
            This site is not affiliated with Cineplex or Landmark Cinemas.
          </span>
        </footer>
      </div>
    </main>
  );
}

const SearchForm = memo(function SearchForm({
  date,
  endDate,
  experienceTypes,
  filters,
  loading,
  location,
  mode,
  movieTitle,
  movieSuggestions,
  movieSuggestionsLoading,
  movieSuggestionsOpen,
  onMovieTitleBlur,
  onMovieTitleFocus,
  onMovieSuggestionSelect,
  onMovieSuggestionsClose,
  onSubmit,
  radiusKm,
  selectedDateIsToday,
  setFilters,
  setExperienceTypes,
  setLocation,
  setMovieTitle,
  setRadiusKm,
  setSortBy,
  sortBy,
  today,
  updateEndDate,
  updateStartDate,
}: SearchFormProps & { mode: UiMode }) {
  const isFun = mode === "fun";
  const selectLabelClass = isFun
    ? "grid gap-2 text-sm font-black uppercase"
    : "grid gap-1.5 text-sm font-medium text-neutral-200";
  const selectClass = isFun
    ? funInputClass
    : "focus-ring h-10 rounded-md border border-neutral-700 bg-[#1b1b1b] px-3 text-base text-white";
  const fieldsetClass = isFun
    ? "grid gap-3 border-[6px] border-black bg-[#ff4fa3] p-3 shadow-[8px_8px_0_#111111]"
    : "grid gap-2 rounded-md border border-neutral-800 bg-[#151515] p-3";
  const legendClass = isFun
    ? "ml-2 flex -rotate-2 items-center gap-2 border-4 border-black bg-[#f7e900] px-3 py-1 text-sm font-black uppercase shadow-[5px_5px_0_#111111]"
    : "flex items-center gap-2 px-1 text-sm font-semibold text-neutral-100";

  return (
    <form className="grid gap-4" onSubmit={onSubmit}>
      <AddressField mode={mode} value={location} onChange={setLocation} />

      <DateRangeFields
        date={date}
        endDate={endDate}
        mode={mode}
        today={today}
        updateEndDate={updateEndDate}
        updateStartDate={updateStartDate}
      />

      <label className={selectLabelClass}>
        Radius
        <select
          className={selectClass}
          value={radiusKm}
          onChange={(event) => setRadiusKm(event.target.value)}
        >
          <option value="10">10 km</option>
          <option value="25">25 km</option>
          <option value="50">50 km</option>
          <option value="100">100 km</option>
        </select>
      </label>

      <label className={selectLabelClass}>
        Sort by
        <select
          className={selectClass}
          value={sortBy}
          onChange={(event) => setSortBy(event.target.value as SortOption)}
        >
          {Object.entries(SORT_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>

      <MovieTitleField
        mode={mode}
        value={movieTitle}
        suggestions={movieSuggestions}
        suggestionsLoading={movieSuggestionsLoading}
        suggestionsOpen={movieSuggestionsOpen}
        onBlur={onMovieTitleBlur}
        onChange={setMovieTitle}
        onFocus={onMovieTitleFocus}
        onRequestClose={onMovieSuggestionsClose}
        onSelect={onMovieSuggestionSelect}
      />

      <TheatreTypeField
        mode={mode}
        selectedTypes={experienceTypes}
        setSelectedTypes={setExperienceTypes}
      />

      <fieldset className={fieldsetClass}>
        <legend className={legendClass}>
          <Filter
            className={isFun ? "h-4 w-4" : "h-4 w-4 text-amber-300"}
            aria-hidden="true"
          />
          Filters
        </legend>
        <FilterControls
          filters={filters}
          mode={mode}
          selectedDateIsToday={selectedDateIsToday}
          setFilters={setFilters}
        />
      </fieldset>

      <SearchButton loading={loading} mode={mode} />
    </form>
  );
});

function DateRangeFields({
  date,
  endDate,
  mode,
  today,
  updateEndDate,
  updateStartDate,
}: {
  date: string;
  endDate: string;
  mode: UiMode;
  today: string;
  updateEndDate: (value: string) => void;
  updateStartDate: (value: string) => void;
}) {
  const isFun = mode === "fun";
  const containerClass = isFun
    ? "grid gap-4 sm:grid-cols-2"
    : "grid gap-3 sm:grid-cols-2";
  const labelClass = isFun
    ? "grid gap-2 text-sm font-black uppercase"
    : "grid gap-1.5 text-sm font-medium text-neutral-200";
  const inputClass = isFun
    ? funInputClass
    : "focus-ring h-10 rounded-md border border-neutral-700 bg-[#1b1b1b] px-3 text-base text-white";

  return (
    <div className={containerClass}>
      <label className={labelClass}>
        Start date
        <input
          className={inputClass}
          type="date"
          value={date}
          min={today}
          onChange={(event) => updateStartDate(event.target.value)}
          required
        />
      </label>

      <label className={labelClass}>
        End date
        <input
          className={inputClass}
          type="date"
          value={endDate}
          min={date}
          max={addDays(date, 2)}
          onChange={(event) => updateEndDate(event.target.value)}
          required
        />
      </label>
    </div>
  );
}

function SearchButton({ loading, mode }: { loading: boolean; mode: UiMode }) {
  const isFun = mode === "fun";

  if (isFun) {
    return (
      <button
        className="focus-ring jitter-hover inline-flex min-h-14 items-center justify-center gap-3 border-[6px] border-black bg-[#f7e900] px-5 text-lg font-black uppercase text-black shadow-[8px_8px_0_#111111] transition hover:-translate-x-1 hover:-translate-y-1 hover:bg-[#00e676] hover:shadow-[12px_12px_0_#111111] active:translate-x-0 active:translate-y-0 disabled:bg-zinc-300 disabled:text-zinc-700"
        type="submit"
        disabled={loading}
      >
        <Search className="h-5 w-5" aria-hidden="true" />
        Search
      </button>
    );
  }

  return (
    <button
      className="focus-ring inline-flex h-11 items-center justify-center gap-2 rounded-md bg-amber-300 px-4 font-semibold text-black transition hover:bg-amber-200 disabled:cursor-wait disabled:bg-neutral-700 disabled:text-neutral-400"
      type="submit"
      disabled={loading}
    >
      <Search className="h-4 w-4" aria-hidden="true" />
      Search
    </button>
  );
}

function CleanSearchLoader({ progress }: { progress: SearchProgress }) {
  return (
    <div
      className="rounded-lg border border-neutral-800 bg-[#111111] p-5 shadow-[0_14px_44px_rgba(0,0,0,0.28)]"
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center gap-4">
        <span
          className="search-spinner search-spinner-clean"
          aria-hidden="true"
        />
        <div>
          <p className="text-sm font-semibold text-white">
            {searchProgressTitle(progress)}
          </p>
          <p className="mt-1 text-sm text-neutral-400">
            {searchProgressDescription(progress)}
          </p>
        </div>
      </div>
    </div>
  );
}

function FunSearchLoader({ progress }: { progress: SearchProgress }) {
  return (
    <div
      className="fun-throbber-panel border-[6px] border-black p-5 text-black shadow-[12px_12px_0_#111111] sm:-rotate-1 sm:p-7"
      role="status"
      aria-live="polite"
    >
      <div className="grid items-center gap-5 md:grid-cols-[180px_minmax(0,1fr)]">
        <span
          className="search-spinner search-spinner-fun mx-auto"
          aria-hidden="true"
        />
        <div className="w-full max-w-5xl">
          <p className="inline-flex -rotate-2 border-4 border-black bg-[#00e676] px-5 py-2 text-[0.8rem] font-black uppercase tracking-[0.14em] shadow-[5px_5px_0_#111111]">
            {searchProgressTitle(progress)}
          </p>
          <p className="mt-4 text-[clamp(1.6rem,4vw,3.2rem)] font-black uppercase leading-none">
            {searchProgressDescription(progress)}
          </p>
        </div>
      </div>
    </div>
  );
}

function ModeSwitchNudge({
  onChange,
  onDismiss,
  show,
  uiMode,
}: {
  onChange: (mode: UiMode) => void;
  onDismiss: () => void;
  show: boolean;
  uiMode: UiMode;
}) {
  const isFun = uiMode === "fun";
  const shellClass = isFun
    ? `relative z-30 inline-flex ${show ? "mb-16 outline outline-[6px] outline-[#f7e900] shadow-[0_0_0_10px_#ff4fa3] sm:mb-0" : ""}`
    : `relative z-30 inline-flex rounded-lg ${show ? "mb-16 ring-4 ring-amber-300 ring-offset-4 ring-offset-[#050505] sm:mb-0" : ""}`;
  const bubbleClass = isFun
    ? "absolute left-0 top-[calc(100%+0.8rem)] z-50 w-64 border-4 border-black bg-[#f7e900] p-3 text-left text-xs font-black uppercase leading-5 text-black shadow-[6px_6px_0_#111111] sm:left-auto sm:right-0"
    : "absolute left-0 top-[calc(100%+0.8rem)] z-50 w-64 rounded-lg border border-amber-300/50 bg-[#111111] p-3 text-left text-sm leading-5 text-neutral-100 shadow-[0_18px_50px_rgba(0,0,0,0.45)] sm:left-auto sm:right-0";

  function handleChange(mode: UiMode) {
    onChange(mode);

    if (show) {
      onDismiss();
    }
  }

  return (
    <span className={shellClass}>
      <ModeSwitch uiMode={uiMode} onChange={handleChange} />
      {show ? (
        <span className={bubbleClass} role="status" aria-live="polite">
          <span className="flex items-start gap-2 pr-7">
            <Sparkles
              className={
                isFun
                  ? "mt-0.5 h-4 w-4 shrink-0"
                  : "mt-0.5 h-4 w-4 shrink-0 text-amber-300"
              }
              aria-hidden="true"
            />
            <span>
              {isFun
                ? "Theme 2 is on. Use this switch to return to theme 1."
                : "Switch to theme 2."}
            </span>
          </span>
          <button
            className={
              isFun
                ? "focus-ring absolute right-2 top-2 grid h-7 w-7 place-items-center border-2 border-black bg-white"
                : "focus-ring absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-md border border-neutral-700 text-neutral-300"
            }
            type="button"
            aria-label="Dismiss themes hint"
            onClick={onDismiss}
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </span>
      ) : null}
    </span>
  );
}

function ModeSwitch({
  uiMode,
  onChange,
}: {
  uiMode: UiMode;
  onChange: (mode: UiMode) => void;
}) {
  const isFun = uiMode === "fun";
  const nextMode = isFun ? "clean" : "fun";

  if (isFun) {
    return (
      <span className="fun-switch-flames">
        <button
          className="focus-ring relative z-10 inline-flex min-h-12 items-center gap-3 border-4 border-black bg-white p-1 text-xs font-black uppercase text-black shadow-[5px_5px_0_#111111] transition hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-[7px_7px_0_#111111]"
          type="button"
          role="switch"
          aria-checked="true"
          title="Themes: 2"
          onClick={() => onChange(nextMode)}
        >
          <span className="inline-flex items-center gap-2 px-2">
            <Sparkles className="h-4 w-4" aria-hidden="true" />
            THEMES
          </span>
          <span className="relative grid h-9 w-32 grid-cols-2 overflow-hidden rounded-full border-4 border-black bg-[#f7e900] text-[10px] leading-none shadow-[3px_3px_0_#111111]">
            <span className="relative z-10 grid place-items-center px-2 transition hover:bg-[#ff8a00] hover:text-black">
              1
            </span>
            <span className="relative z-10 grid place-items-center px-2 transition hover:bg-[#00e676]">
              2
            </span>
            <span
              className="absolute bottom-1 right-1 top-1 w-[calc(50%-4px)] rounded-full bg-[#00d5ff]"
              aria-hidden="true"
            />
          </span>
        </button>
      </span>
    );
  }

  return (
    <button
      className="focus-ring inline-flex h-10 items-center gap-2 rounded-md border border-neutral-700 bg-black/40 p-1.5 text-xs font-semibold text-neutral-200 transition hover:border-neutral-500 hover:bg-neutral-900"
      type="button"
      role="switch"
      aria-checked="false"
      title="Themes: 1"
      onClick={() => onChange(nextMode)}
    >
      <span className="px-1">THEMES</span>
      <span
        className="relative grid h-7 w-24 grid-cols-2 overflow-hidden rounded-full border border-neutral-600 bg-neutral-950 text-[12px] font-bold leading-none shadow-inner"
        aria-hidden="true"
      >
        <span className="relative z-10 grid place-items-center text-black transition hover:bg-white/80">
          1
        </span>
        <span className="relative z-10 grid place-items-center text-neutral-400 transition hover:bg-amber-300/15 hover:text-amber-100">
          2
        </span>
        <span
          className="absolute bottom-0.5 left-0.5 top-0.5 w-[calc(50%-2px)] rounded-full bg-neutral-200"
          aria-hidden="true"
        />
      </span>
    </button>
  );
}

function MovieTitleField({
  mode,
  onBlur,
  onChange,
  onFocus,
  onRequestClose,
  onSelect,
  suggestions,
  suggestionsLoading,
  suggestionsOpen,
  value,
}: {
  mode: UiMode;
  onBlur: () => void;
  onChange: (value: string) => void;
  onFocus: () => void;
  onRequestClose: () => void;
  onSelect: (title: string) => void;
  suggestions: MovieSuggestion[];
  suggestionsLoading: boolean;
  suggestionsOpen: boolean;
  value: string;
}) {
  const isFun = mode === "fun";
  const listIsVisible =
    suggestionsOpen && (suggestions.length > 0 || suggestionsLoading);
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(-1);
  const wrapperClass = isFun
    ? "relative grid gap-2 text-sm font-black uppercase"
    : "relative grid gap-1.5 text-sm font-medium text-neutral-200";
  const inputClass = isFun
    ? funInputClass
    : "focus-ring h-10 rounded-md border border-neutral-700 bg-[#1b1b1b] px-3 text-base text-white placeholder:text-neutral-500";
  const panelClass = isFun
    ? "absolute left-0 right-0 top-full z-30 mt-2 max-h-56 overflow-auto border-4 border-black bg-white p-1 text-black shadow-[7px_7px_0_#111111]"
    : "absolute left-0 right-0 top-full z-30 mt-1 max-h-56 overflow-auto rounded-md border border-neutral-700 bg-[#111111] p-1 shadow-[0_16px_40px_rgba(0,0,0,0.45)]";
  const optionClass = isFun
    ? "focus-ring flex w-full items-start justify-between gap-3 border-2 border-transparent px-3 py-2 text-left text-sm font-black uppercase transition hover:border-black hover:bg-[#f7e900]"
    : "focus-ring flex w-full items-start justify-between gap-3 rounded px-3 py-2 text-left text-sm text-neutral-100 transition hover:bg-neutral-800";
  const metaClass = isFun
    ? "shrink-0 text-xs text-zinc-700"
    : "shrink-0 text-xs text-neutral-400";

  useEffect(() => {
    if (!suggestionsOpen || !suggestions.length) {
      setActiveSuggestionIndex(-1);
    }
  }, [suggestions.length, suggestionsOpen]);

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      onRequestClose();
      setActiveSuggestionIndex(-1);
      return;
    }

    if (!listIsVisible || suggestionsLoading || !suggestions.length) {
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveSuggestionIndex((current) => (current + 1) % suggestions.length);
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveSuggestionIndex((current) =>
        current <= 0 ? suggestions.length - 1 : current - 1,
      );
      return;
    }

    if (event.key === "Enter" && activeSuggestionIndex >= 0) {
      event.preventDefault();
      onSelect(suggestions[activeSuggestionIndex].title);
    }
  }

  return (
    <div className={wrapperClass}>
      <label htmlFor="movie-title">Movie title</label>
      <input
        aria-autocomplete="list"
        aria-activedescendant={
          activeSuggestionIndex >= 0
            ? `movie-title-suggestion-${activeSuggestionIndex}`
            : undefined
        }
        aria-controls={listIsVisible ? "movie-title-suggestions" : undefined}
        aria-expanded={listIsVisible}
        aria-haspopup="listbox"
        className={inputClass}
        id="movie-title"
        role="combobox"
        value={value}
        onBlur={onBlur}
        onChange={(event) => onChange(event.target.value)}
        onFocus={onFocus}
        onKeyDown={handleKeyDown}
        placeholder="Optional"
      />
      {listIsVisible ? (
        <div
          aria-busy={suggestionsLoading}
          id="movie-title-suggestions"
          role="listbox"
          className={panelClass}
        >
          {suggestionsLoading ? (
            <div
              className={
                isFun
                  ? "px-3 py-2 text-sm font-black uppercase"
                  : "px-3 py-2 text-sm text-neutral-300"
              }
              role="status"
              aria-live="polite"
            >
              Checking showtimes
            </div>
          ) : null}
          {suggestions.map((suggestion, index) => (
            <button
              className={optionClass}
              id={`movie-title-suggestion-${index}`}
              key={suggestion.title}
              type="button"
              role="option"
              aria-selected={index === activeSuggestionIndex}
              onMouseDown={(event) => {
                event.preventDefault();
              }}
              onMouseEnter={() => setActiveSuggestionIndex(index)}
              onClick={() => onSelect(suggestion.title)}
            >
              <span>{suggestion.title}</span>
              <span className={metaClass}>
                {suggestion.theatreCount} theatre
                {suggestion.theatreCount === 1 ? "" : "s"}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function TheatreTypeField({
  mode,
  selectedTypes,
  setSelectedTypes,
}: {
  mode: UiMode;
  selectedTypes: ShowtimeExperienceType[];
  setSelectedTypes: Dispatch<SetStateAction<ShowtimeExperienceType[]>>;
}) {
  const isFun = mode === "fun";
  const labelId = `theatre-type-label-${mode}`;
  const detailsClass = isFun
    ? "relative text-sm font-black uppercase"
    : "relative text-sm font-medium text-neutral-200";
  const summaryClass = isFun
    ? `${funInputClass} flex cursor-pointer list-none items-center justify-between gap-3 [&::-webkit-details-marker]:hidden`
    : "focus-ring flex h-10 cursor-pointer list-none items-center justify-between gap-3 rounded-md border border-neutral-700 bg-[#1b1b1b] px-3 text-base text-white [&::-webkit-details-marker]:hidden";
  const panelClass = isFun
    ? "absolute left-0 right-0 top-full z-30 mt-2 grid max-h-72 gap-2 overflow-auto border-4 border-black bg-[#fff8df] p-3 text-black shadow-[7px_7px_0_#111111]"
    : "absolute left-0 right-0 top-full z-30 mt-1 grid max-h-72 gap-2 overflow-auto rounded-md border border-neutral-700 bg-[#111111] p-3 shadow-[0_16px_40px_rgba(0,0,0,0.45)]";

  function toggleType(
    experienceType: ShowtimeExperienceType,
    checked: boolean,
  ) {
    setSelectedTypes((current) =>
      SHOWTIME_EXPERIENCE_TYPES.filter((option) =>
        checked
          ? option === experienceType || current.includes(option)
          : option !== experienceType && current.includes(option),
      ),
    );
  }

  return (
    <div className="grid gap-1.5">
      <span
        className={
          isFun
            ? "text-sm font-black uppercase"
            : "text-sm font-medium text-neutral-200"
        }
        id={labelId}
      >
        Theatre type
      </span>
      <details aria-labelledby={labelId} className={detailsClass}>
        <summary className={summaryClass}>
          <span>
            {selectedTypes.length
              ? `${selectedTypes.length} selected`
              : "No filter"}
          </span>
          <ChevronDown className="h-4 w-4 shrink-0" aria-hidden="true" />
        </summary>
        <div className={panelClass}>
          {selectedTypes.length ? (
            <button
              className={
                isFun
                  ? "focus-ring justify-self-start border-2 border-black bg-white px-2 py-1 text-xs"
                  : "focus-ring justify-self-start rounded border border-neutral-600 px-2 py-1 text-xs text-neutral-300"
              }
              type="button"
              onClick={() => setSelectedTypes([])}
            >
              Clear all
            </button>
          ) : null}
          {SHOWTIME_EXPERIENCE_TYPES.map((experienceType) => (
            <label
              className={
                isFun
                  ? "flex min-h-9 items-center justify-between gap-3 border-2 border-black bg-white px-2 py-1"
                  : "flex min-h-8 items-center justify-between gap-3 text-neutral-200"
              }
              key={experienceType}
            >
              <span>{experienceType}</span>
              <input
                className={
                  isFun
                    ? "h-5 w-5 accent-[#ff4fa3]"
                    : "h-4 w-4 accent-amber-300"
                }
                type="checkbox"
                checked={selectedTypes.includes(experienceType)}
                onChange={(event) =>
                  toggleType(experienceType, event.target.checked)
                }
              />
            </label>
          ))}
        </div>
      </details>
    </div>
  );
}

function FilterControls({
  filters,
  mode,
  selectedDateIsToday,
  setFilters,
}: {
  filters: SearchFilters;
  mode: UiMode;
  selectedDateIsToday: boolean;
  setFilters: Dispatch<SetStateAction<SearchFilters>>;
}) {
  return FILTER_OPTIONS.map((option) => {
    const props = {
      checked: isFilterChecked(filters, option, selectedDateIsToday),
      disabled: option.todayOnly && !selectedDateIsToday,
      label: option.label,
      onChange: (value: boolean) =>
        setFilters((current) => ({ ...current, [option.key]: value })),
    };

    return mode === "fun" ? (
      <FunFilterToggle key={option.key} {...props} />
    ) : (
      <CleanFilterToggle key={option.key} {...props} />
    );
  });
}

function CleanFilterToggle({
  checked,
  disabled = false,
  label,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onChange: (value: boolean) => void;
}) {
  return (
    <label
      className={`flex items-center justify-between gap-3 text-sm ${disabled ? "text-neutral-500" : "text-neutral-200"}`}
    >
      <span>{label}</span>
      <input
        className="h-4 w-4 accent-amber-300"
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
    </label>
  );
}

function CleanResultCard({ result }: { result: SearchResult }) {
  const startsAt = new Date(result.showtime.startsAt);
  const checkedAt = new Date(result.snapshot.checkedAt);
  const providerLabel = cinemaProviderLabel(result.theatre.provider);
  const timeZoneOptions = theatreTimeZoneOptions(result.theatre);
  const showtimeLinkContext = `${result.showtime.movieTitle} at ${result.theatre.name} on ${startsAt.toLocaleString([], timeZoneOptions)}`;

  return (
    <article className="result-card rounded-lg border border-neutral-800 bg-[#111111] p-4 shadow-[0_14px_44px_rgba(0,0,0,0.28)]">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-neutral-800 pb-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-amber-300">
            {providerLabel}
          </p>
          <h2 className="text-lg font-semibold text-white">
            {result.theatre.name}
          </h2>
          <p className="mt-1 flex items-center gap-1 text-sm text-neutral-400">
            <MapPin className="h-4 w-4 text-amber-300" aria-hidden="true" />
            {result.theatre.city}, {result.theatre.province}
            {result.distanceKm !== undefined
              ? ` - ${result.distanceKm.toFixed(1)} km`
              : ""}
          </p>
        </div>
        <div className="grid w-full gap-2 sm:w-auto sm:grid-cols-2">
          {result.showtime.purchaseUrl ? (
            <a
              className="focus-ring inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-amber-300 px-3 py-2 text-sm font-semibold text-black transition hover:bg-amber-200"
              href={result.showtime.purchaseUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Buy tickets for ${showtimeLinkContext} on ${providerLabel} (opens in a new tab)`}
            >
              Buy tickets
              <ExternalLink className="h-4 w-4" aria-hidden="true" />
            </a>
          ) : (
            <span className="inline-flex min-h-11 items-center justify-center rounded-md border border-neutral-800 px-3 py-2 text-sm text-neutral-400">
              Purchase unavailable
            </span>
          )}
          <a
            className="focus-ring inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-neutral-700 px-3 py-2 text-sm font-semibold text-neutral-100 transition hover:border-amber-300 hover:text-amber-200"
            href={result.showtime.seatPreviewUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Preview seats for ${showtimeLinkContext} (opens in a new tab)`}
          >
            Preview seats
            <ExternalLink className="h-4 w-4" aria-hidden="true" />
          </a>
        </div>
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-[1fr_auto]">
        <div>
          <p className="flex items-center gap-2 font-semibold text-neutral-100">
            <Clock className="h-4 w-4 text-emerald-300" aria-hidden="true" />
            {startsAt.toLocaleDateString([], {
              ...timeZoneOptions,
              weekday: "short",
              month: "short",
              day: "numeric",
            })}{" "}
            at{" "}
            {startsAt.toLocaleTimeString([], {
              ...timeZoneOptions,
              hour: "numeric",
              minute: "2-digit",
            })}{" "}
            - {result.showtime.movieTitle}
          </p>
          <p className="mt-1 text-sm text-neutral-400">
            {[result.showtime.format, result.showtime.auditorium]
              .filter(Boolean)
              .join(" - ")}
          </p>
        </div>

        <div className="grid min-w-56 gap-1 rounded-md border border-neutral-800 bg-black/35 p-3 text-sm">
          <p className="font-semibold text-white">
            {result.snapshot.occupiedEstimate} occupied /{" "}
            {result.snapshot.sellableSeats} seats
          </p>
          {result.theatre.provider === "landmark" ? (
            <>
              <p className="text-neutral-300">
                {result.snapshot.occupiedAccessibleSeats} occupied /{" "}
                {result.snapshot.accessibleSeats} accessible seats
              </p>
              <p className="text-neutral-300">
                {result.snapshot.occupiedCompanionSeats} occupied /{" "}
                {result.snapshot.companionSeats} companion seats
              </p>
            </>
          ) : null}
          <p className="text-neutral-400">
            Last checked {relativeMinutes(checkedAt)} min ago
          </p>
        </div>
      </div>
    </article>
  );
}

const CleanResultList = memo(function CleanResultList({
  results,
}: {
  results: SearchResult[];
}) {
  return (
    <div className="grid gap-3">
      {results.map((result) => (
        <CleanResultCard key={result.showtime.id} result={result} />
      ))}
    </div>
  );
});

function HeaderStat({
  accent,
  icon,
  label,
  value,
}: {
  accent: string;
  icon: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="stat-slab flex min-h-[4.15rem] items-center gap-2 border-b-[6px] border-white/20 p-3 last:border-b-0 sm:min-h-24 sm:gap-3 sm:border-b-0 sm:border-r-[6px] sm:border-white/20 sm:p-4 sm:last:border-r-0 lg:border-b-[6px] lg:border-r-0 lg:last:border-b-0">
      <span
        className={`grid h-9 w-9 shrink-0 place-items-center border-[3px] border-white text-black shadow-[3px_3px_0_#ffffff] sm:h-11 sm:w-11 sm:border-4 sm:shadow-[4px_4px_0_#ffffff] ${accent}`}
      >
        {icon}
      </span>
      <div className="min-w-0">
        <p className="text-[0.62rem] font-black uppercase tracking-[0.12em] text-[#00d5ff] sm:text-xs sm:tracking-[0.16em]">
          {label}
        </p>
        <p className="truncate text-base font-black uppercase sm:text-lg">
          {value}
        </p>
      </div>
    </div>
  );
}

function QueryChip({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <span className="inline-flex max-w-full -rotate-1 items-center gap-2 border-4 border-white bg-[#f7e900] px-3 py-2 text-sm font-black uppercase text-black shadow-[5px_5px_0_#ffffff] even:rotate-1">
      {icon}
      <span className="truncate">{label}</span>
    </span>
  );
}

function FunFilterToggle({
  checked,
  disabled = false,
  label,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onChange: (value: boolean) => void;
}) {
  return (
    <label
      className={`flex min-h-12 items-center justify-between gap-3 border-4 border-black px-3 py-2 text-sm font-black uppercase shadow-[5px_5px_0_#111111] transition hover:-translate-y-0.5 ${
        disabled
          ? "bg-zinc-300 text-zinc-600"
          : checked
            ? "bg-[#00e676] text-black"
            : "bg-white text-black"
      }`}
    >
      <span>{label}</span>
      <input
        className="h-5 w-5 accent-[#ff4fa3]"
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
    </label>
  );
}

function FunResultCard({ result }: { result: SearchResult }) {
  const startsAt = new Date(result.showtime.startsAt);
  const checkedAt = new Date(result.snapshot.checkedAt);
  const providerLabel = cinemaProviderLabel(result.theatre.provider);
  const timeZoneOptions = theatreTimeZoneOptions(result.theatre);
  const showtimeLinkContext = `${result.showtime.movieTitle} at ${result.theatre.name} on ${startsAt.toLocaleString([], timeZoneOptions)}`;
  const openSeats = Math.max(
    0,
    result.snapshot.sellableSeats - result.snapshot.occupiedEstimate,
  );
  const occupancy =
    result.snapshot.sellableSeats > 0
      ? Math.round(
          (result.snapshot.occupiedEstimate / result.snapshot.sellableSeats) *
            100,
        )
      : 0;

  return (
    <article
      className={`result-card chaos-card relative border-[6px] border-black bg-white ${funCardShadow}`}
    >
      <div className="chaos-card-head grid gap-3 border-b-[6px] border-black p-4 lg:grid-cols-[1fr_auto]">
        <div className="min-w-0">
          <p className="mb-2 text-xs font-black uppercase tracking-[0.16em]">
            {providerLabel}
          </p>
          <h2 className="text-[clamp(1.75rem,4vw,2.6rem)] font-black uppercase leading-none text-black">
            {result.theatre.name}
          </h2>
          <p className="mt-2 flex flex-wrap items-center gap-2 text-sm font-black uppercase">
            <MapPin className="h-4 w-4 text-[#ff4fa3]" aria-hidden="true" />
            <span>
              {result.theatre.city}, {result.theatre.province}
            </span>
            {result.distanceKm !== undefined ? (
              <span>{result.distanceKm.toFixed(1)} km</span>
            ) : null}
          </p>
        </div>
        <div className="grid w-full gap-3 sm:w-auto sm:grid-cols-2">
          {result.showtime.purchaseUrl ? (
            <a
              className="focus-ring inline-flex min-h-12 -rotate-1 items-center justify-center gap-2 border-4 border-black bg-[#ff4fa3] px-4 text-sm font-black uppercase shadow-[5px_5px_0_#111111] transition hover:-translate-x-1 hover:-translate-y-1 hover:bg-[#00e676] hover:shadow-[8px_8px_0_#111111]"
              href={result.showtime.purchaseUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Buy tickets for ${showtimeLinkContext} on ${providerLabel} (opens in a new tab)`}
            >
              Buy tickets
              <ExternalLink className="h-4 w-4" aria-hidden="true" />
            </a>
          ) : (
            <span className="inline-flex min-h-12 items-center justify-center border-4 border-black bg-zinc-300 px-4 text-sm font-black uppercase text-zinc-600">
              Purchase unavailable
            </span>
          )}
          <a
            className="focus-ring inline-flex min-h-12 rotate-1 items-center justify-center gap-2 border-4 border-black bg-white px-4 text-sm font-black uppercase shadow-[5px_5px_0_#111111] transition hover:-translate-x-1 hover:-translate-y-1 hover:bg-[#00d5ff] hover:shadow-[8px_8px_0_#111111]"
            href={result.showtime.seatPreviewUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Preview seats for ${showtimeLinkContext} (opens in a new tab)`}
          >
            Preview seats
            <ExternalLink className="h-4 w-4" aria-hidden="true" />
          </a>
        </div>
      </div>

      <div className="grid lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="grid content-start gap-4 bg-[#fff8df] p-4">
          <div>
            <p className="flex flex-wrap items-center gap-2 text-xl font-black uppercase leading-tight">
              <Clock className="h-5 w-5 text-[#00a651]" aria-hidden="true" />
              <span>
                {startsAt.toLocaleDateString([], {
                  ...timeZoneOptions,
                  weekday: "short",
                  month: "short",
                  day: "numeric",
                })}
              </span>
              <span>
                {startsAt.toLocaleTimeString([], {
                  ...timeZoneOptions,
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </span>
              <span>{result.showtime.movieTitle}</span>
            </p>
            <p className="mt-2 text-sm font-black uppercase text-zinc-700">
              {[result.showtime.format, result.showtime.auditorium]
                .filter(Boolean)
                .join(" / ")}
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <MetricSlab
              label="Open seats"
              value={String(openSeats)}
              tone="bg-[#00e676]"
              tilt="-rotate-2"
            />
            <MetricSlab
              label="Occupied"
              value={`${result.snapshot.occupiedEstimate}/${result.snapshot.sellableSeats}`}
              tone="bg-[#ff4fa3]"
              tilt="rotate-1"
            />
            <MetricSlab
              label="Occupancy"
              value={`${occupancy}%`}
              tone="bg-[#00d5ff]"
              tilt="-rotate-1"
            />
          </div>
        </div>

        <aside className="grid border-t-[6px] border-black bg-black text-white lg:border-l-[6px] lg:border-t-0">
          <div className="grid gap-2 p-4 text-sm font-bold uppercase text-zinc-100">
            {result.theatre.provider === "landmark" ? (
              <>
                <p>
                  {result.snapshot.occupiedAccessibleSeats} occupied /{" "}
                  {result.snapshot.accessibleSeats} accessible seats
                </p>
                <p>
                  {result.snapshot.occupiedCompanionSeats} occupied /{" "}
                  {result.snapshot.companionSeats} companion seats
                </p>
              </>
            ) : null}
            <p>Last checked {relativeMinutes(checkedAt)} min ago</p>
          </div>
        </aside>
      </div>
    </article>
  );
}

const FunResultList = memo(function FunResultList({
  results,
}: {
  results: SearchResult[];
}) {
  const [visibleCount, setVisibleCount] = useState(FUN_RESULT_BATCH_SIZE);
  const visibleResults = results.slice(0, visibleCount);
  const remainingCount = results.length - visibleResults.length;

  return (
    <>
      <div className="grid gap-5">
        {visibleResults.map((result) => (
          <FunResultCard key={result.showtime.id} result={result} />
        ))}
      </div>
      {remainingCount > 0 ? (
        <button
          className="focus-ring mx-auto inline-flex min-h-14 items-center justify-center border-[6px] border-black bg-[#f7e900] px-6 text-base font-black uppercase text-black shadow-[8px_8px_0_#111111] transition hover:bg-[#00e676]"
          type="button"
          onClick={() =>
            startTransition(() =>
              setVisibleCount((count) => count + FUN_RESULT_BATCH_SIZE),
            )
          }
        >
          Show {Math.min(FUN_RESULT_BATCH_SIZE, remainingCount)} more results
        </button>
      ) : null}
    </>
  );
});

function MetricSlab({
  label,
  value,
  tone,
  tilt,
}: {
  label: string;
  value: string;
  tone: string;
  tilt: string;
}) {
  return (
    <div
      className={`border-4 border-black p-3 text-black shadow-[5px_5px_0_#111111] ${tone} ${tilt}`}
    >
      <p className="text-xs font-black uppercase tracking-[0.14em]">{label}</p>
      <p className="mt-1 text-3xl font-black leading-none">{value}</p>
    </div>
  );
}

function isFilterChecked(
  filters: SearchFilters,
  option: FilterOption,
  selectedDateIsToday: boolean,
): boolean {
  return option.todayOnly
    ? selectedDateIsToday && filters[option.key]
    : filters[option.key];
}

function cinemaProviderLabel(provider: CinemaProvider): string {
  return provider === "landmark" ? "Landmark Cinemas" : "Cineplex";
}

function theatreTimeZoneOptions(
  theatre: Theatre,
): Pick<Intl.DateTimeFormatOptions, "timeZone"> {
  return theatre.timeZone ? { timeZone: theatre.timeZone } : {};
}

function sortLabel(sortBy: SortOption): string {
  return SORT_LABELS[sortBy];
}

function resultCount(
  results: SearchResult[],
  loading: boolean,
): string {
  if (loading) {
    return "Searching";
  }

  return String(results.length);
}

function searchProgressTitle(progress: SearchProgress): string {
  return progress.total > 0
    ? `Checking ${progress.checked} of ${progress.total} showtimes`
    : "Finding showtimes";
}

function searchProgressDescription(progress: SearchProgress): string {
  return progress.total > 0
    ? "Results appear as their seat maps are checked."
    : "Checking nearby theatres before counting seats.";
}

function relativeMinutes(date: Date): number {
  const now = new Date();
  return Math.max(
    0,
    Math.round((now.getTime() - date.getTime()) / 60000),
  );
}

function resolveStateAction<T>(action: SetStateAction<T>, current: T): T {
  return typeof action === "function"
    ? (action as (value: T) => T)(current)
    : action;
}

function getResultSearchState(
  scope: SearchState | undefined,
  current: SearchState,
): SearchState {
  if (!scope) {
    return current;
  }

  if (getSearchScopeKey(scope) !== getSearchScopeKey(current)) {
    return scope;
  }

  return {
    ...scope,
    experienceTypes: current.experienceTypes,
    filters: current.filters,
    movieTitle: current.movieTitle,
    sortBy: current.sortBy,
  };
}

function getResultViewSignature(state: SearchState): string {
  return JSON.stringify({
    experienceTypes: [...state.experienceTypes].sort(),
    filters: state.filters,
    movieTitle: state.movieTitle.trim().toLowerCase(),
    sortBy: state.sortBy,
  });
}

function getHydrationSignature(state: SearchState): string {
  return JSON.stringify({
    experienceTypes: [...state.experienceTypes].sort(),
    movieTitle: state.movieTitle.trim().toLowerCase(),
    nonVipOnly: state.filters.nonVipOnly,
    startsInNextTwoHours: state.filters.startsInNextTwoHours,
  });
}
