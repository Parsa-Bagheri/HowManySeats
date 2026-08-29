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
  X
} from "lucide-react";
import {
  type Dispatch,
  type FormEvent,
  type ReactNode,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import AddressField, { type LocationCoordinates } from "@/app/address-field";
import { addDays, formatDateRangeLabel, normalizeEndDate } from "@/lib/date-range";
import {
  SHOWTIME_EXPERIENCE_TYPES,
  type ShowtimeExperienceType
} from "@/lib/experience-types";
import { formatConfidence } from "@/lib/seat-scoring";
import {
  buildSearchParams,
  getEffectiveFilters,
  getLocalDateInputValue,
  makeDefaultSearchState,
  normalizeSearchState,
  readSearchStateFromUrl,
  rememberSearchState,
  type SearchFilters,
  type SearchState
} from "@/lib/search-state";
import type { MovieSuggestion, SearchResult, SortOption } from "@/lib/types";
import {
  parseUiMode,
  UI_MODE_COOKIE_NAME,
  UI_MODE_STORAGE_KEY,
  type UiMode
} from "@/lib/ui-mode";

type HomePageClientProps = {
  hasInitialUiModeCookie: boolean;
  initialUiMode: UiMode;
};

type SearchViewProps = {
  activeFilterCount: number;
  date: string;
  endDate: string;
  error: string | undefined;
  experienceTypes: ShowtimeExperienceType[];
  filters: SearchFilters;
  hasSearched: boolean;
  loading: boolean;
  location: string;
  movieTitle: string;
  movieSuggestions: MovieSuggestion[];
  movieSuggestionsLoading: boolean;
  movieSuggestionsOpen: boolean;
  onMovieTitleBlur: () => void;
  onMovieTitleFocus: () => void;
  onMovieSuggestionSelect: (title: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  radiusKm: string;
  results: SearchResult[];
  selectedDateIsToday: boolean;
  setFilters: Dispatch<SetStateAction<SearchFilters>>;
  setExperienceTypes: Dispatch<SetStateAction<ShowtimeExperienceType[]>>;
  setLocation: (value: string, coordinates?: LocationCoordinates) => void;
  setMovieTitle: (value: string) => void;
  setRadiusKm: (value: string) => void;
  setSortBy: (value: SortOption) => void;
  setUiMode: (mode: UiMode) => void;
  showFunModePrompt: boolean;
  sortBy: SortOption;
  uiMode: UiMode;
  onDismissFunModePrompt: () => void;
  updateEndDate: (value: string) => void;
  updateStartDate: (value: string) => void;
};

type FilterOption = {
  key: keyof SearchFilters;
  label: string;
  todayOnly?: boolean;
};

const FILTER_OPTIONS: FilterOption[] = [
  { key: "onlyZeroSold", label: "0 seats sold" },
  { key: "maxFiveSold", label: "5 or fewer seats sold" },
  { key: "startsInNextTwoHours", label: "Starts in next 2 hours", todayOnly: true },
  { key: "nonVipOnly", label: "Non-VIP only" },
  { key: "accessibleAvailable", label: "Accessible seating available" }
];

const SORT_OPTIONS: Array<{ value: SortOption; label: string }> = [
  { value: "distance-asc", label: "Distance nearest first" },
  { value: "distance-desc", label: "Distance farthest first" },
  { value: "time-asc", label: "Time earliest first" },
  { value: "time-desc", label: "Time latest first" }
];

const FUN_MODE_PROMPT_STORAGE_KEY = "empty-theatres-fun-mode-prompt-seen";
const UI_MODE_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

const funInputClass =
  "focus-ring h-12 w-full border-4 border-black bg-[#fff8df] px-3 text-base font-black text-black shadow-[6px_6px_0_#111111] transition placeholder:text-zinc-500 focus:-translate-y-0.5 focus:shadow-[8px_8px_0_#111111]";
const funPanelShadow = "shadow-[12px_12px_0_#111111]";
const funCardShadow = "shadow-[10px_10px_0_#111111]";

export default function HomePageClient({ hasInitialUiModeCookie, initialUiMode }: HomePageClientProps) {
  const today = getLocalDateInputValue();
  const initialState = useMemo(() => makeDefaultSearchState(), []);
  const [location, setLocation] = useState(initialState.location);
  const [date, setDate] = useState(initialState.date);
  const [endDate, setEndDate] = useState(initialState.endDate);
  const [latitude, setLatitude] = useState(initialState.latitude);
  const [longitude, setLongitude] = useState(initialState.longitude);
  const [radiusKm, setRadiusKm] = useState(initialState.radiusKm);
  const [movieTitle, setMovieTitle] = useState(initialState.movieTitle);
  const [experienceTypes, setExperienceTypes] = useState<ShowtimeExperienceType[]>(initialState.experienceTypes);
  const [movieSuggestions, setMovieSuggestions] = useState<MovieSuggestion[]>([]);
  const [movieSuggestionsLoading, setMovieSuggestionsLoading] = useState(false);
  const [movieSuggestionsOpen, setMovieSuggestionsOpen] = useState(false);
  const [sortBy, setSortBy] = useState<SortOption>(initialState.sortBy);
  const [filters, setFilters] = useState<SearchFilters>(initialState.filters);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [hasSearched, setHasSearched] = useState(false);
  const [uiMode, setUiModeState] = useState<UiMode>(initialUiMode);
  const [showFunModePrompt, setShowFunModePrompt] = useState(false);
  const loadedSavedState = useRef(false);
  const movieTitleFocused = useRef(false);
  const skipNextMovieSuggestionFetch = useRef(false);

  const searchState: SearchState = {
    location,
    date,
    endDate,
    radiusKm,
    latitude,
    longitude,
    movieTitle,
    experienceTypes,
    sortBy,
    filters
  };
  const selectedDateIsToday = date === today && endDate === today;
  const activeFilterCount =
    Object.values(getEffectiveFilters(searchState, today)).filter(Boolean).length + experienceTypes.length;

  const setUiMode = useCallback((mode: UiMode) => {
    setUiModeState(mode);
    rememberUiModePreference(mode);
  }, []);

  const dismissFunModePrompt = useCallback(() => {
    setShowFunModePrompt(false);
  }, []);

  const updateLocation = useCallback((value: string, coordinates?: LocationCoordinates) => {
    setLocation(value);
    setLatitude(coordinates?.latitude);
    setLongitude(coordinates?.longitude);
  }, []);

  const updateMovieTitle = useCallback((value: string) => {
    setMovieTitle(value);
    setMovieSuggestionsOpen(movieTitleFocused.current && value.trim().length >= 2);
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
    setMovieTitle(title);
    setMovieSuggestions([]);
    setMovieSuggestionsOpen(false);
    setMovieSuggestionsLoading(false);
  }, []);

  const executeSearch = useCallback(async (state: SearchState) => {
    setLoading(true);
    setError(undefined);

    const params = buildSearchParams(state);
    const response = await fetch(`/api/search?${params.toString()}`);
    const body = (await response.json()) as { results?: SearchResult[]; error?: string };

    setLoading(false);
    setHasSearched(true);
    window.history.replaceState(null, "", `/?${params.toString()}`);
    rememberSearchState(window.localStorage, state, true);

    if (!response.ok) {
      setResults([]);
      setError(body.error ?? "Search failed");
      return;
    }

    setResults(body.results ?? []);
  }, []);

  useEffect(() => {
    const savedMode = parseUiMode(window.localStorage.getItem(UI_MODE_STORAGE_KEY));
    const nextMode = hasInitialUiModeCookie ? initialUiMode : (savedMode ?? initialUiMode);

    setUiModeState(nextMode);
    rememberUiModePreference(nextMode);
  }, [hasInitialUiModeCookie, initialUiMode]);

  useEffect(() => {
    if (window.localStorage.getItem(FUN_MODE_PROMPT_STORAGE_KEY) === "true") {
      return;
    }

    window.localStorage.setItem(FUN_MODE_PROMPT_STORAGE_KEY, "true");
    setShowFunModePrompt(true);
  }, []);

  useEffect(() => {
    if (loadedSavedState.current) {
      return;
    }

    loadedSavedState.current = true;
    const saved = readSearchStateFromUrl(window.location.search);

    if (!saved) {
      return;
    }

    const state = normalizeSearchState(saved);
    setLocation(state.location);
    setDate(state.date);
    setEndDate(state.endDate);
    setLatitude(state.latitude);
    setLongitude(state.longitude);
    setRadiusKm(state.radiusKm);
    setMovieTitle(state.movieTitle);
    setExperienceTypes(state.experienceTypes);
    setSortBy(state.sortBy);
    setFilters(state.filters);
    setHasSearched(false);
    setResults([]);
    setError(undefined);
  }, []);

  useEffect(() => {
    if (!loadedSavedState.current) {
      return;
    }

    rememberSearchState(window.localStorage, searchState, hasSearched);
  }, [date, endDate, experienceTypes, filters, hasSearched, latitude, location, longitude, movieTitle, radiusKm, sortBy]);

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
        const params = new URLSearchParams({
          location,
          date,
          endDate,
          radiusKm,
          query,
          limit: "8"
        });

        if (latitude !== undefined && longitude !== undefined) {
          params.set("latitude", String(latitude));
          params.set("longitude", String(longitude));
        }
        const response = await fetch(`/api/movie-suggestions?${params.toString()}`, {
          signal: controller.signal
        });
        const body = (await response.json()) as { suggestions?: MovieSuggestion[] };
        const suggestions = response.ok ? (body.suggestions ?? []) : [];

        setMovieSuggestions(suggestions);
        setMovieSuggestionsOpen(movieTitleFocused.current && suggestions.length > 0);
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

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await executeSearch(searchState);
  }

  function updateStartDate(value: string) {
    const nextEndDate = value ? normalizeEndDate(value, endDate) : endDate;
    setDate(value);
    setEndDate(nextEndDate);

    if (value !== today || nextEndDate !== today) {
      setFilters((current) => ({ ...current, startsInNextTwoHours: false }));
    }
  }

  function updateEndDate(value: string) {
    const nextEndDate = normalizeEndDate(date, value);
    setEndDate(nextEndDate);

    if (date !== today || nextEndDate !== today) {
      setFilters((current) => ({ ...current, startsInNextTwoHours: false }));
    }
  }

  const viewProps: SearchViewProps = {
    activeFilterCount,
    date,
    endDate,
    error,
    experienceTypes,
    filters,
    hasSearched,
    loading,
    location,
    movieTitle,
    movieSuggestions,
    movieSuggestionsLoading,
    movieSuggestionsOpen,
    onMovieTitleBlur,
    onMovieTitleFocus,
    onMovieSuggestionSelect,
    onSubmit,
    radiusKm,
    results,
    selectedDateIsToday,
    setFilters,
    setExperienceTypes,
    setLocation: updateLocation,
    setMovieTitle: updateMovieTitle,
    setRadiusKm,
    setSortBy,
    setUiMode,
    showFunModePrompt,
    sortBy,
    uiMode,
    onDismissFunModePrompt: dismissFunModePrompt,
    updateEndDate,
    updateStartDate
  };

  return uiMode === "fun" ? <FunHomeView {...viewProps} /> : <CleanHomeView {...viewProps} />;
}

function rememberUiModePreference(mode: UiMode) {
  window.localStorage.setItem(UI_MODE_STORAGE_KEY, mode);
  document.cookie = `${UI_MODE_COOKIE_NAME}=${mode}; Path=/; Max-Age=${UI_MODE_COOKIE_MAX_AGE_SECONDS}; SameSite=Lax`;
  document.documentElement.removeAttribute("data-ui-mode-pending");
}

function CleanHomeView({
  activeFilterCount,
  date,
  endDate,
  error,
  experienceTypes,
  filters,
  hasSearched,
  loading,
  location,
  movieTitle,
  movieSuggestions,
  movieSuggestionsLoading,
  movieSuggestionsOpen,
  onMovieTitleBlur,
  onMovieTitleFocus,
  onMovieSuggestionSelect,
  onSubmit,
  radiusKm,
  results,
  selectedDateIsToday,
  setFilters,
  setExperienceTypes,
  setLocation,
  setMovieTitle,
  setRadiusKm,
  setSortBy,
  setUiMode,
  showFunModePrompt,
  sortBy,
  uiMode,
  onDismissFunModePrompt,
  updateEndDate,
  updateStartDate
}: SearchViewProps) {
  return (
    <main className="flex min-h-screen flex-col bg-[#050505] px-4 py-5 text-neutral-100 sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-5">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold leading-tight text-white">(Probably) Empty Theatres</h1>
            <p className="mt-2 text-sm leading-5 text-neutral-300">Use this website to find a quiet theatre near you.</p>
            <p className="mt-2 text-xs leading-5 text-neutral-400">Idea borrowed from Riley Walz.</p>
          </div>
          <div className="shrink-0 sm:ml-auto">
            <ModeSwitchNudge
              uiMode={uiMode}
              show={showFunModePrompt}
              onChange={setUiMode}
              onDismiss={onDismissFunModePrompt}
            />
          </div>
        </header>

        <div className="grid w-full flex-1 gap-5 lg:grid-cols-[380px_1fr]">
        <section className="rounded-lg border border-neutral-800 bg-[#111111] p-4 shadow-[0_18px_70px_rgba(0,0,0,0.45)]">
          <form className="grid gap-4" onSubmit={onSubmit}>
            <AddressField mode="clean" value={location} onChange={setLocation} />

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="grid gap-1.5 text-sm font-medium text-neutral-200">
                Start date
                <input
                  className="focus-ring h-10 rounded-md border border-neutral-700 bg-[#1b1b1b] px-3 text-base text-white"
                  type="date"
                  value={date}
                  min={getLocalDateInputValue()}
                  onChange={(event) => updateStartDate(event.target.value)}
                  required
                />
              </label>

              <label className="grid gap-1.5 text-sm font-medium text-neutral-200">
                End date
                <input
                  className="focus-ring h-10 rounded-md border border-neutral-700 bg-[#1b1b1b] px-3 text-base text-white"
                  type="date"
                  value={endDate}
                  min={date}
                  max={addDays(date, 2)}
                  onChange={(event) => updateEndDate(event.target.value)}
                  required
                />
              </label>
            </div>

            <label className="grid gap-1.5 text-sm font-medium text-neutral-200">
              Radius
              <select
                className="focus-ring h-10 rounded-md border border-neutral-700 bg-[#1b1b1b] px-3 text-base text-white"
                value={radiusKm}
                onChange={(event) => setRadiusKm(event.target.value)}
              >
                <option value="10">10 km</option>
                <option value="25">25 km</option>
                <option value="50">50 km</option>
                <option value="100">100 km</option>
              </select>
            </label>

            <label className="grid gap-1.5 text-sm font-medium text-neutral-200">
              Sort by
              <select
                className="focus-ring h-10 rounded-md border border-neutral-700 bg-[#1b1b1b] px-3 text-base text-white"
                value={sortBy}
                onChange={(event) => setSortBy(event.target.value as SortOption)}
              >
                {SORT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <MovieTitleField
              mode="clean"
              value={movieTitle}
              suggestions={movieSuggestions}
              suggestionsLoading={movieSuggestionsLoading}
              suggestionsOpen={movieSuggestionsOpen}
              onBlur={onMovieTitleBlur}
              onChange={setMovieTitle}
              onFocus={onMovieTitleFocus}
              onSelect={onMovieSuggestionSelect}
            />

            <TheatreTypeField
              mode="clean"
              selectedTypes={experienceTypes}
              setSelectedTypes={setExperienceTypes}
            />

            <fieldset className="grid gap-2 rounded-md border border-neutral-800 bg-[#151515] p-3">
              <legend className="flex items-center gap-2 px-1 text-sm font-semibold text-neutral-100">
                <Filter className="h-4 w-4 text-amber-300" aria-hidden="true" />
                Filters
              </legend>
              {FILTER_OPTIONS.map((option) => (
                <CleanFilterToggle
                  key={option.key}
                  checked={isFilterChecked(filters, option, selectedDateIsToday)}
                  disabled={option.todayOnly && !selectedDateIsToday}
                  label={option.label}
                  onChange={(value) => setFilters((current) => setFilterValue(current, option.key, value))}
                />
              ))}
            </fieldset>

            <SearchButton loading={loading} mode="clean" />
          </form>
        </section>

        <section className="grid content-start gap-3">
          <div className="rounded-lg border border-neutral-800 bg-[#111111] p-4 shadow-[0_18px_70px_rgba(0,0,0,0.35)]">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="text-sm text-neutral-400">Results</p>
                <p className="mt-1 text-3xl font-semibold text-white">{resultCount(results, loading)}</p>
              </div>
              <div className="text-right text-sm text-neutral-400">
                <p>{location.trim() || "No location"} - {formatDateRangeLabel(date, endDate)}</p>
                <p>{activeFilterCount} active filter{activeFilterCount === 1 ? "" : "s"}</p>
                <p>{sortLabel(sortBy)}</p>
              </div>
            </div>
            <p className="mt-4 max-w-3xl text-sm leading-6 text-neutral-300">
              Results are likely empty, not guaranteed. Accessibility, blocked, house-reserved, and unknown seats are kept out of occupied counts.
            </p>
          </div>

          {error ? (
            <div className="rounded-md border border-red-500/40 bg-red-950/40 p-3 text-sm text-red-100">{error}</div>
          ) : null}

          {loading ? <CleanSearchLoader /> : null}

          {!loading && hasSearched && !error && results.length === 0 ? (
            <div className="rounded-lg border border-neutral-800 bg-[#111111] p-5 text-sm leading-6 text-neutral-300">
              No matching likely-empty showtimes were returned for this search. Try clearing the low-occupancy filter or using a future date.
            </div>
          ) : null}

          <div className="grid gap-3">
            {results.map((result) => (
              <CleanResultCard key={result.showtime.id} result={result} />
            ))}
          </div>
        </section>
        </div>
      </div>
      <footer className="mx-auto mt-5 grid w-full max-w-7xl gap-1 border-t border-neutral-900 pt-4 text-center text-xs text-neutral-500">
        <p>Made in Waterloo, with love</p>
        <p>This site is not affiliated with Cineplex.</p>
      </footer>
    </main>
  );
}

function FunHomeView({
  activeFilterCount,
  date,
  endDate,
  error,
  experienceTypes,
  filters,
  hasSearched,
  loading,
  location,
  movieTitle,
  movieSuggestions,
  movieSuggestionsLoading,
  movieSuggestionsOpen,
  onMovieTitleBlur,
  onMovieTitleFocus,
  onMovieSuggestionSelect,
  onSubmit,
  radiusKm,
  results,
  selectedDateIsToday,
  setFilters,
  setExperienceTypes,
  setLocation,
  setMovieTitle,
  setRadiusKm,
  setSortBy,
  setUiMode,
  showFunModePrompt,
  sortBy,
  uiMode,
  onDismissFunModePrompt,
  updateEndDate,
  updateStartDate
}: SearchViewProps) {
  return (
    <main className="chaos-stage min-h-screen overflow-hidden px-3 py-4 text-black sm:px-5 lg:px-8">
      <div className="relative z-10 mx-auto flex w-full max-w-[1500px] flex-col gap-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="min-w-0 flex-1">
            <MarqueeStrip />
          </div>
          <div className="shrink-0 sm:pl-3">
            <ModeSwitchNudge
              uiMode={uiMode}
              show={showFunModePrompt}
              onChange={setUiMode}
              onDismiss={onDismissFunModePrompt}
            />
          </div>
        </div>

        <header className={`chaos-panel relative overflow-hidden border-[6px] border-black bg-white ${funPanelShadow} sm:-rotate-[0.25deg]`}>
          <div
            className="pointer-events-none absolute -right-12 top-5 hidden rotate-12 border-4 border-black bg-[#00e676] px-10 py-2 text-sm font-black uppercase tracking-[0.16em] shadow-[6px_6px_0_#111111] md:block"
            aria-hidden="true"
          >
            unofficial
          </div>
          <div className="grid gap-0 lg:grid-cols-[1fr_auto]">
            <div className="hero-blast relative border-b-[6px] border-black bg-[#ff4fa3] p-4 sm:p-7 lg:border-b-0 lg:border-r-[6px]">
              <h1 className="ransom-title relative max-w-5xl break-words text-[clamp(3rem,9vw,7.75rem)] font-black leading-[0.83] text-black">
                <span className="inline-block -rotate-1 bg-[#f7e900] px-2 shadow-[6px_6px_0_#111111]">(Probably)</span>{" "}
                <span className="inline-block rotate-1 bg-white px-2 shadow-[6px_6px_0_#111111]">Empty</span>{" "}
                <span className="ink-pop inline-block -rotate-2 px-2 text-white">Theatres</span>
              </h1>
              <p className="hero-diamond-textbox relative mt-5 max-w-3xl text-sm font-black normal-case tracking-[0.08em] text-[#00d5ff]">
                Why do you want an empty theatre? kinda weird
              </p>
              <p className="relative mt-3 inline-flex -rotate-1 border-2 border-black bg-white px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.14em] shadow-[3px_3px_0_#111111]">
                Idea borrowed from Riley Walz
              </p>
            </div>
            <div className="fun-header-stats grid min-w-0 bg-black text-white sm:grid-cols-2 lg:min-w-64 lg:grid-cols-1">
              <HeaderStat
                icon={<SlidersHorizontal className="h-5 w-5" aria-hidden="true" />}
                label="Filters"
                value={`${activeFilterCount} active`}
                accent="bg-[#f7e900]"
              />
              <HeaderStat
                icon={<CalendarDays className="h-5 w-5" aria-hidden="true" />}
                label="Date"
                value={formatDateRangeLabel(date, endDate)}
                accent="bg-[#00d5ff]"
              />
            </div>
          </div>
        </header>

        <div className="grid gap-5 xl:grid-cols-[430px_minmax(0,1fr)]">
          <section className={`chaos-panel border-[6px] border-black bg-[#00d5ff] p-4 ${funPanelShadow} sm:rotate-[-0.35deg] xl:sticky xl:top-5 xl:self-start`}>
            <div className="panic-heading mb-5 border-[6px] border-black p-3 shadow-[7px_7px_0_#111111]">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.16em]">Search console</p>
                <h2 className="mt-1 break-words text-[clamp(1.85rem,5.2vw,3.2rem)] font-black uppercase leading-none">
                  Find a private (Cineplex) theatre near you, yes you
                </h2>
              </div>
            </div>

            <form className="grid gap-4" onSubmit={onSubmit}>
              <AddressField mode="fun" value={location} onChange={setLocation} />

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="grid gap-2 text-sm font-black uppercase">
                  Start date
                  <input
                    className={funInputClass}
                    type="date"
                    value={date}
                    min={getLocalDateInputValue()}
                    onChange={(event) => updateStartDate(event.target.value)}
                    required
                  />
                </label>

                <label className="grid gap-2 text-sm font-black uppercase">
                  End date
                  <input
                    className={funInputClass}
                    type="date"
                    value={endDate}
                    min={date}
                    max={addDays(date, 2)}
                    onChange={(event) => updateEndDate(event.target.value)}
                    required
                  />
                </label>
              </div>

              <label className="grid gap-2 text-sm font-black uppercase">
                Radius
                <select
                  className={funInputClass}
                  value={radiusKm}
                  onChange={(event) => setRadiusKm(event.target.value)}
                >
                  <option value="10">10 km</option>
                  <option value="25">25 km</option>
                  <option value="50">50 km</option>
                  <option value="100">100 km</option>
                </select>
              </label>

              <label className="grid gap-2 text-sm font-black uppercase">
                Sort by
                <select
                  className={funInputClass}
                  value={sortBy}
                  onChange={(event) => setSortBy(event.target.value as SortOption)}
                >
                  {SORT_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <MovieTitleField
                mode="fun"
                value={movieTitle}
                suggestions={movieSuggestions}
                suggestionsLoading={movieSuggestionsLoading}
                suggestionsOpen={movieSuggestionsOpen}
                onBlur={onMovieTitleBlur}
                onChange={setMovieTitle}
                onFocus={onMovieTitleFocus}
                onSelect={onMovieSuggestionSelect}
              />

              <TheatreTypeField
                mode="fun"
                selectedTypes={experienceTypes}
                setSelectedTypes={setExperienceTypes}
              />

              <fieldset className="grid gap-3 border-[6px] border-black bg-[#ff4fa3] p-3 shadow-[8px_8px_0_#111111]">
                <legend className="ml-2 flex -rotate-2 items-center gap-2 border-4 border-black bg-[#f7e900] px-3 py-1 text-sm font-black uppercase shadow-[5px_5px_0_#111111]">
                  <Filter className="h-4 w-4" aria-hidden="true" />
                  Filters
                </legend>
                {FILTER_OPTIONS.map((option) => (
                  <FunFilterToggle
                    key={option.key}
                    checked={isFilterChecked(filters, option, selectedDateIsToday)}
                    disabled={option.todayOnly && !selectedDateIsToday}
                    label={option.label}
                    onChange={(value) => setFilters((current) => setFilterValue(current, option.key, value))}
                  />
                ))}
              </fieldset>

              <SearchButton loading={loading} mode="fun" />
            </form>
          </section>

          <section className="grid content-start gap-5">
            <div className={`chaos-panel relative overflow-hidden border-[6px] border-black bg-black text-white ${funPanelShadow} sm:rotate-[0.3deg]`}>
              <div className="absolute right-0 top-0 hidden h-full w-7 bg-[repeating-linear-gradient(180deg,#f7e900_0_12px,#111111_12px_24px)] lg:block" aria-hidden="true" />
              <div className="grid gap-0 lg:grid-cols-[400px_1fr]">
                <div className="relative border-b-[6px] border-black bg-[#00e676] p-5 text-black lg:border-b-0 lg:border-r-[6px]">
                  <p className="text-sm font-black uppercase tracking-[0.16em]">Results</p>
                  <p className={`mt-1 font-black leading-none ${loading ? "text-[clamp(2.5rem,4.5vw,4rem)]" : "text-[clamp(4rem,10vw,7rem)]"}`}>
                    {resultCount(results, loading)}
                  </p>
                </div>
                <div className="grid gap-4 p-5 lg:pr-12">
                  <div className="flex flex-wrap gap-3">
                    <QueryChip icon={<MapPin className="h-4 w-4" aria-hidden="true" />} label={location.trim() || "No location"} />
                    <QueryChip icon={<CalendarDays className="h-4 w-4" aria-hidden="true" />} label={formatDateRangeLabel(date, endDate)} />
                    <QueryChip icon={<Radar className="h-4 w-4" aria-hidden="true" />} label={`${radiusKm} km`} />
                    <QueryChip icon={<Filter className="h-4 w-4" aria-hidden="true" />} label={`${activeFilterCount} filters`} />
                    <QueryChip icon={<ArrowDownUp className="h-4 w-4" aria-hidden="true" />} label={sortLabel(sortBy)} />
                  </div>
                  <p className="max-w-4xl text-sm font-bold leading-6 text-zinc-100">
                    Results are likely empty, not guaranteed. Accessibility, blocked, house-reserved, and unknown seats are kept out of occupied counts.
                  </p>
                </div>
              </div>
            </div>

            {error ? (
              <div className="border-[6px] border-black bg-[#ff4f4f] p-4 text-sm font-black uppercase text-black shadow-[10px_10px_0_#111111] sm:-rotate-1">
                {error}
              </div>
            ) : null}

            {loading ? <FunSearchLoader /> : null}

            {!loading && hasSearched && !error && results.length === 0 ? (
              <div className="border-[6px] border-black bg-white p-5 text-sm font-black uppercase leading-6 shadow-[10px_10px_0_#111111] sm:rotate-1">
                No matching likely-empty showtimes were returned for this search. Try clearing the low-occupancy filter or using a future date.
              </div>
            ) : null}

            <div className="grid gap-5">
              {results.map((result) => (
                <FunResultCard key={result.showtime.id} result={result} />
              ))}
            </div>
          </section>
        </div>
        <footer className="grid gap-2 border-[6px] border-black bg-[#00e676] px-4 py-4 text-center text-sm font-black uppercase tracking-[0.16em] shadow-[10px_10px_0_#111111] sm:-rotate-[0.35deg]">
          <span className="inline-block justify-self-center -rotate-1 bg-white px-3 py-1 shadow-[5px_5px_0_#111111]">Made in Waterloo, with love</span>
          <span className="inline-block justify-self-center rotate-1 bg-white px-3 py-1 text-[0.7rem] shadow-[5px_5px_0_#111111]">
            This site is not affiliated with Cineplex.
          </span>
        </footer>
      </div>
    </main>
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

function CleanSearchLoader() {
  return (
    <div className="rounded-lg border border-neutral-800 bg-[#111111] p-5 shadow-[0_14px_44px_rgba(0,0,0,0.28)]" role="status" aria-live="polite">
      <div className="flex items-center gap-4">
        <span className="search-spinner search-spinner-clean" aria-hidden="true" />
        <div>
          <p className="text-sm font-semibold text-white">Searching showtimes</p>
          <p className="mt-1 text-sm text-neutral-400">Checking nearby theatres and seat maps.</p>
        </div>
      </div>
    </div>
  );
}

function FunSearchLoader() {
  return (
    <div className="fun-throbber-panel border-[6px] border-black p-5 text-black shadow-[12px_12px_0_#111111] sm:-rotate-1 sm:p-7" role="status" aria-live="polite">
      <div className="grid items-center gap-5 md:grid-cols-[180px_minmax(0,1fr)]">
        <span className="search-spinner search-spinner-fun mx-auto" aria-hidden="true" />
        <div className="w-full max-w-5xl">
          <p className="inline-flex -rotate-2 border-4 border-black bg-[#00e676] px-5 py-2 text-[0.8rem] font-black uppercase tracking-[0.14em] shadow-[5px_5px_0_#111111]">
            Searching
          </p>
          <p className="mt-4 text-[clamp(1.6rem,4vw,3.2rem)] font-black uppercase leading-none">
            Pinging every suspiciously empty room
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
  uiMode
}: {
  onChange: (mode: UiMode) => void;
  onDismiss: () => void;
  show: boolean;
  uiMode: UiMode;
}) {
  const isFun = uiMode === "fun";
  const shellClass = isFun
    ? `relative z-30 inline-flex ${show ? "outline outline-[6px] outline-[#f7e900] shadow-[0_0_0_10px_#ff4fa3]" : ""}`
    : `relative z-30 inline-flex rounded-lg ${show ? "ring-4 ring-amber-300 ring-offset-4 ring-offset-[#050505]" : ""}`;
  const bubbleClass = isFun
    ? "absolute right-0 top-[calc(100%+0.8rem)] z-50 w-64 border-4 border-black bg-[#f7e900] p-3 text-left text-xs font-black uppercase leading-5 text-black shadow-[6px_6px_0_#111111]"
    : "absolute right-0 top-[calc(100%+0.8rem)] z-50 w-64 rounded-lg border border-amber-300/50 bg-[#111111] p-3 text-left text-sm leading-5 text-neutral-100 shadow-[0_18px_50px_rgba(0,0,0,0.45)]";

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
            <Sparkles className={isFun ? "mt-0.5 h-4 w-4 shrink-0" : "mt-0.5 h-4 w-4 shrink-0 text-amber-300"} aria-hidden="true" />
            <span>{isFun ? "Theme 2 is on. Use this switch to return to theme 1." : "Switch to theme 2."}</span>
          </span>
          <button
            className={isFun ? "focus-ring absolute right-2 top-2 grid h-7 w-7 place-items-center border-2 border-black bg-white" : "focus-ring absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-md border border-neutral-700 text-neutral-300"}
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

function ModeSwitch({ uiMode, onChange }: { uiMode: UiMode; onChange: (mode: UiMode) => void }) {
  const isFun = uiMode === "fun";
  const nextMode = isFun ? "clean" : "fun";

  if (isFun) {
    return (
      <span className="fun-switch-flames">
        {[
          "fun-fire-top-left",
          "fun-fire-top-center",
          "fun-fire-top-right",
          "fun-fire-bottom-left",
          "fun-fire-bottom-right",
          "fun-fire-left",
          "fun-fire-right"
        ].map((position) => (
          <FireSticker className={position} key={position} />
        ))}
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
            <span className="relative z-10 grid place-items-center px-2 transition hover:bg-[#ff8a00] hover:text-black">1</span>
            <span className="relative z-10 grid place-items-center px-2 transition hover:bg-[#00e676]">2</span>
            <span className="absolute bottom-1 right-1 top-1 w-[calc(50%-4px)] rounded-full bg-[#00d5ff]" aria-hidden="true" />
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
        <span className="relative z-10 grid place-items-center text-black transition hover:bg-white/80">1</span>
        <span className="relative z-10 grid place-items-center text-neutral-400 transition hover:bg-amber-300/15 hover:text-amber-100">2</span>
        <span className="absolute bottom-0.5 left-0.5 top-0.5 w-[calc(50%-2px)] rounded-full bg-neutral-200" aria-hidden="true" />
      </span>
    </button>
  );
}

function FireSticker({ className }: { className: string }) {
  return (
    <span className={`fun-fire-sticker ${className}`} aria-hidden="true">
      <iframe
        src="https://tenor.com/embed/14295562"
        title="Decorative animated fire"
        loading="lazy"
        tabIndex={-1}
      />
    </span>
  );
}

function MovieTitleField({
  mode,
  onBlur,
  onChange,
  onFocus,
  onSelect,
  suggestions,
  suggestionsLoading,
  suggestionsOpen,
  value
}: {
  mode: UiMode;
  onBlur: () => void;
  onChange: (value: string) => void;
  onFocus: () => void;
  onSelect: (title: string) => void;
  suggestions: MovieSuggestion[];
  suggestionsLoading: boolean;
  suggestionsOpen: boolean;
  value: string;
}) {
  const isFun = mode === "fun";
  const listIsVisible = suggestionsOpen && (suggestions.length > 0 || suggestionsLoading);
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
  const metaClass = isFun ? "shrink-0 text-xs text-zinc-700" : "shrink-0 text-xs text-neutral-400";

  return (
    <div className={wrapperClass}>
      <label htmlFor="movie-title">Movie title</label>
      <input
        aria-autocomplete="list"
        aria-controls="movie-title-suggestions"
        aria-expanded={listIsVisible}
        className={inputClass}
        id="movie-title"
        value={value}
        onBlur={onBlur}
        onChange={(event) => onChange(event.target.value)}
        onFocus={onFocus}
        placeholder="Optional"
      />
      {listIsVisible ? (
        <div id="movie-title-suggestions" role="listbox" className={panelClass}>
          {suggestionsLoading ? (
            <div className={isFun ? "px-3 py-2 text-sm font-black uppercase" : "px-3 py-2 text-sm text-neutral-300"}>
              Checking showtimes
            </div>
          ) : null}
          {suggestions.map((suggestion) => (
            <button
              className={optionClass}
              key={suggestion.title}
              type="button"
              role="option"
              aria-selected={suggestion.title === value}
              onMouseDown={(event) => {
                event.preventDefault();
                onSelect(suggestion.title);
              }}
            >
              <span>{suggestion.title}</span>
              <span className={metaClass}>
                {suggestion.theatreCount} theatre{suggestion.theatreCount === 1 ? "" : "s"}
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
  setSelectedTypes
}: {
  mode: UiMode;
  selectedTypes: ShowtimeExperienceType[];
  setSelectedTypes: Dispatch<SetStateAction<ShowtimeExperienceType[]>>;
}) {
  const isFun = mode === "fun";
  const detailsClass = isFun ? "relative text-sm font-black uppercase" : "relative text-sm font-medium text-neutral-200";
  const summaryClass = isFun
    ? `${funInputClass} flex cursor-pointer list-none items-center justify-between gap-3 [&::-webkit-details-marker]:hidden`
    : "focus-ring flex h-10 cursor-pointer list-none items-center justify-between gap-3 rounded-md border border-neutral-700 bg-[#1b1b1b] px-3 text-base text-white [&::-webkit-details-marker]:hidden";
  const panelClass = isFun
    ? "absolute left-0 right-0 top-full z-30 mt-2 grid max-h-72 gap-2 overflow-auto border-4 border-black bg-[#fff8df] p-3 text-black shadow-[7px_7px_0_#111111]"
    : "absolute left-0 right-0 top-full z-30 mt-1 grid max-h-72 gap-2 overflow-auto rounded-md border border-neutral-700 bg-[#111111] p-3 shadow-[0_16px_40px_rgba(0,0,0,0.45)]";

  function toggleType(experienceType: ShowtimeExperienceType, checked: boolean) {
    setSelectedTypes((current) =>
      SHOWTIME_EXPERIENCE_TYPES.filter((option) =>
        checked ? option === experienceType || current.includes(option) : option !== experienceType && current.includes(option)
      )
    );
  }

  return (
    <div className="grid gap-1.5">
      <span className={isFun ? "text-sm font-black uppercase" : "text-sm font-medium text-neutral-200"}>Theatre type</span>
      <details className={detailsClass}>
        <summary className={summaryClass}>
          <span>{selectedTypes.length ? `${selectedTypes.length} selected` : "No filter"}</span>
          <ChevronDown className="h-4 w-4 shrink-0" aria-hidden="true" />
        </summary>
        <div className={panelClass}>
          {selectedTypes.length ? (
            <button
              className={isFun ? "focus-ring justify-self-start border-2 border-black bg-white px-2 py-1 text-xs" : "focus-ring justify-self-start rounded border border-neutral-600 px-2 py-1 text-xs text-neutral-300"}
              type="button"
              onClick={() => setSelectedTypes([])}
            >
              Clear all
            </button>
          ) : null}
          {SHOWTIME_EXPERIENCE_TYPES.map((experienceType) => (
            <label
              className={isFun ? "flex min-h-9 items-center justify-between gap-3 border-2 border-black bg-white px-2 py-1" : "flex min-h-8 items-center justify-between gap-3 text-neutral-200"}
              key={experienceType}
            >
              <span>{experienceType}</span>
              <input
                className={isFun ? "h-5 w-5 accent-[#ff4fa3]" : "h-4 w-4 accent-amber-300"}
                type="checkbox"
                checked={selectedTypes.includes(experienceType)}
                onChange={(event) => toggleType(experienceType, event.target.checked)}
              />
            </label>
          ))}
        </div>
      </details>
    </div>
  );
}

function CleanFilterToggle({
  checked,
  disabled = false,
  label,
  onChange
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className={`flex items-center justify-between gap-3 text-sm ${disabled ? "text-neutral-500" : "text-neutral-200"}`}>
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

  return (
    <article className="rounded-lg border border-neutral-800 bg-[#111111] p-4 shadow-[0_14px_44px_rgba(0,0,0,0.28)]">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-neutral-800 pb-3">
        <div>
          <h2 className="text-lg font-semibold text-white">{result.theatre.name}</h2>
          <p className="mt-1 flex items-center gap-1 text-sm text-neutral-400">
            <MapPin className="h-4 w-4 text-amber-300" aria-hidden="true" />
            {result.theatre.city}, {result.theatre.province}
            {result.distanceKm !== undefined ? ` - ${result.distanceKm.toFixed(1)} km` : ""}
          </p>
        </div>
        <a
          className="focus-ring inline-flex items-center gap-2 rounded-md border border-neutral-700 px-3 py-2 text-sm font-semibold text-neutral-100 transition hover:border-amber-300 hover:text-amber-200"
          href={result.showtime.ticketUrl}
          target="_blank"
          rel="noreferrer"
        >
          View on Cineplex
          <ExternalLink className="h-4 w-4" aria-hidden="true" />
        </a>
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-[1fr_auto]">
        <div>
          <p className="flex items-center gap-2 font-semibold text-neutral-100">
            <Clock className="h-4 w-4 text-emerald-300" aria-hidden="true" />
            {startsAt.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })} at{" "}
            {startsAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} - {result.showtime.movieTitle}
          </p>
          <p className="mt-1 text-sm text-neutral-400">
            {[result.showtime.format, result.showtime.auditorium].filter(Boolean).join(" - ")}
          </p>
        </div>

        <div className="grid min-w-56 gap-1 rounded-md border border-neutral-800 bg-black/35 p-3 text-sm">
          <p className="font-semibold text-white">
            {result.snapshot.occupiedEstimate} occupied / {result.snapshot.sellableSeats} seats
          </p>
          <p className="text-amber-200">{formatConfidence(result.snapshot.confidence)}</p>
          <p className="text-neutral-400">Last checked {relativeMinutes(checkedAt)} min ago</p>
          <p className="text-neutral-400">
            Ambiguous seats: {result.snapshot.accessibilityCount + result.snapshot.blockedCount + result.snapshot.unknownCount}
          </p>
        </div>
      </div>
    </article>
  );
}

function MarqueeStrip() {
  const chunks = [
    "low occupancy signal",
    "low occupancy signal",
    "low occupancy signal"
  ];

  return (
    <div className="marquee-strip border-[6px] border-black bg-black text-[#f7e900] shadow-[8px_8px_0_#111111]" aria-label="Site status">
      <div className="marquee-track">
        {[...chunks, ...chunks].map((chunk, index) => (
          <span className="marquee-chunk text-[0.68rem] font-black uppercase tracking-[0.08em] sm:text-[0.74rem]" key={`${chunk}-${index}`}>
            {chunk}
          </span>
        ))}
      </div>
    </div>
  );
}

function HeaderStat({
  accent,
  icon,
  label,
  value
}: {
  accent: string;
  icon: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="stat-slab flex min-h-[4.15rem] items-center gap-2 border-b-[6px] border-white/20 p-3 last:border-b-0 sm:min-h-24 sm:gap-3 sm:border-b-0 sm:border-r-[6px] sm:border-white/20 sm:p-4 sm:last:border-r-0 lg:border-b-[6px] lg:border-r-0 lg:last:border-b-0">
      <span className={`grid h-9 w-9 shrink-0 place-items-center border-[3px] border-white text-black shadow-[3px_3px_0_#ffffff] sm:h-11 sm:w-11 sm:border-4 sm:shadow-[4px_4px_0_#ffffff] ${accent}`}>{icon}</span>
      <div className="min-w-0">
        <p className="text-[0.62rem] font-black uppercase tracking-[0.12em] text-[#00d5ff] sm:text-xs sm:tracking-[0.16em]">{label}</p>
        <p className="truncate text-base font-black uppercase sm:text-lg">{value}</p>
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

function GoofyLoader() {
  return (
    <div
      className="goofy-loader-panel border-[6px] border-black bg-[#f7e900] p-5 text-black shadow-[12px_12px_0_#111111] sm:-rotate-1"
      role="status"
      aria-live="polite"
    >
      <div className="grid items-center gap-5 md:grid-cols-[180px_minmax(0,1fr)]">
        <div className="goofy-spinner mx-auto" aria-hidden="true">
          <div className="goofy-face">
            <span className="goofy-eye goofy-eye-left" />
            <span className="goofy-eye goofy-eye-right" />
            <span className="goofy-mouth" />
            <span className="goofy-tooth goofy-tooth-left" />
            <span className="goofy-tooth goofy-tooth-right" />
          </div>
        </div>
        <div>
          <p className="inline-flex -rotate-2 border-4 border-black bg-[#ff4fa3] px-3 py-1 text-xs font-black uppercase tracking-[0.16em] shadow-[5px_5px_0_#111111]">
            Searching
          </p>
          <p className="mt-4 text-[clamp(2rem,5vw,4rem)] font-black uppercase leading-none">
            Spinning up the empty-theatre detector
          </p>
        </div>
      </div>
    </div>
  );
}

function FunFilterToggle({
  checked,
  disabled = false,
  label,
  onChange
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onChange: (value: boolean) => void;
}) {
  return (
    <label
      className={`flex min-h-12 items-center justify-between gap-3 border-4 border-black px-3 py-2 text-sm font-black uppercase shadow-[5px_5px_0_#111111] transition hover:-translate-y-0.5 ${
        disabled ? "bg-zinc-300 text-zinc-600" : checked ? "bg-[#00e676] text-black" : "bg-white text-black"
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
  const emptySeats = Math.max(0, result.snapshot.sellableSeats - result.snapshot.occupiedEstimate);
  const occupancy =
    result.snapshot.sellableSeats > 0
      ? Math.round((result.snapshot.occupiedEstimate / result.snapshot.sellableSeats) * 100)
      : 0;

  return (
    <article className={`chaos-card relative border-[6px] border-black bg-white ${funCardShadow}`}>
      <div className="chaos-card-head grid gap-3 border-b-[6px] border-black p-4 lg:grid-cols-[1fr_auto]">
        <div className="min-w-0">
          <h2 className="text-[clamp(1.75rem,4vw,2.6rem)] font-black uppercase leading-none text-black">{result.theatre.name}</h2>
          <p className="mt-2 flex flex-wrap items-center gap-2 text-sm font-black uppercase">
            <MapPin className="h-4 w-4 text-[#ff4fa3]" aria-hidden="true" />
            <span>
              {result.theatre.city}, {result.theatre.province}
            </span>
            {result.distanceKm !== undefined ? <span>{result.distanceKm.toFixed(1)} km</span> : null}
          </p>
        </div>
        <a
          className="focus-ring inline-flex min-h-12 rotate-1 items-center justify-center gap-2 border-4 border-black bg-white px-4 text-sm font-black uppercase shadow-[5px_5px_0_#111111] transition hover:-translate-x-1 hover:-translate-y-1 hover:bg-[#00d5ff] hover:shadow-[8px_8px_0_#111111]"
          href={result.showtime.ticketUrl}
          target="_blank"
          rel="noreferrer"
        >
          Cineplex
          <ExternalLink className="h-4 w-4" aria-hidden="true" />
        </a>
      </div>

      <div className="grid lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="grid content-start gap-4 bg-[#fff8df] p-4">
          <div>
            <p className="flex flex-wrap items-center gap-2 text-xl font-black uppercase leading-tight">
              <Clock className="h-5 w-5 text-[#00a651]" aria-hidden="true" />
              <span>{startsAt.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })}</span>
              <span>{startsAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>
              <span>{result.showtime.movieTitle}</span>
            </p>
            <p className="mt-2 text-sm font-black uppercase text-zinc-700">
              {[result.showtime.format, result.showtime.auditorium].filter(Boolean).join(" / ")}
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <MetricSlab label="Open seats" value={String(emptySeats)} tone="bg-[#00e676]" tilt="-rotate-2" />
            <MetricSlab label="Occupied" value={`${result.snapshot.occupiedEstimate}/${result.snapshot.sellableSeats}`} tone="bg-[#ff4fa3]" tilt="rotate-1" />
            <MetricSlab label="Occupancy" value={`${occupancy}%`} tone="bg-[#00d5ff]" tilt="-rotate-1" />
          </div>
        </div>

        <aside className="grid border-t-[6px] border-black bg-black text-white lg:border-l-[6px] lg:border-t-0">
          <div className="border-b-[6px] border-white/20 p-4">
            <p className="text-2xl font-black uppercase">{formatConfidence(result.snapshot.confidence)}</p>
          </div>
          <div className="grid gap-2 p-4 text-sm font-bold uppercase text-zinc-100">
            <p>Last checked {relativeMinutes(checkedAt)} min ago</p>
            <p>
              Ambiguous seats: {result.snapshot.accessibilityCount + result.snapshot.blockedCount + result.snapshot.unknownCount}
            </p>
          </div>
        </aside>
      </div>
    </article>
  );
}

function MetricSlab({ label, value, tone, tilt }: { label: string; value: string; tone: string; tilt: string }) {
  return (
    <div className={`border-4 border-black p-3 text-black shadow-[5px_5px_0_#111111] ${tone} ${tilt}`}>
      <p className="text-xs font-black uppercase tracking-[0.14em]">{label}</p>
      <p className="mt-1 text-3xl font-black leading-none">{value}</p>
    </div>
  );
}

function isFilterChecked(filters: SearchFilters, option: FilterOption, selectedDateIsToday: boolean): boolean {
  return option.todayOnly ? selectedDateIsToday && filters[option.key] : filters[option.key];
}

function setFilterValue(filters: SearchFilters, key: keyof SearchFilters, value: boolean): SearchFilters {
  return { ...filters, [key]: value };
}

function sortLabel(sortBy: SortOption): string {
  return SORT_OPTIONS.find((option) => option.value === sortBy)?.label ?? "Distance nearest first";
}

function resultCount(results: SearchResult[], loading: boolean): string {
  if (loading) {
    return "Searching";
  }

  return String(results.length);
}

function relativeMinutes(date: Date): number {
  const now = new Date();
  return Math.max(0, Math.round((now.getTime() - date.getTime()) / 60000));
}
