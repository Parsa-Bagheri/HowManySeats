"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { UiMode } from "@/lib/ui-mode";

export type LocationCoordinates = { latitude: number; longitude: number };

type AddressFieldProps = {
  mode: UiMode;
  onChange: (value: string, coordinates?: LocationCoordinates) => void;
  value: string;
};

type GooglePlace = {
  fetchFields: (request: { fields: string[] }) => Promise<void>;
  formattedAddress?: string;
  location?: { lat: () => number; lng: () => number };
};

type GooglePlacePrediction = {
  placeId: string;
  text: { toString: () => string };
  toPlace: () => GooglePlace;
};

type GooglePlacesLibrary = {
  AutocompleteSessionToken: new () => object;
  AutocompleteSuggestion: {
    fetchAutocompleteSuggestions: (request: {
      input: string;
      includedRegionCodes: string[];
      language: string;
      region: string;
      sessionToken: object;
    }) => Promise<{ suggestions: { placePrediction?: GooglePlacePrediction }[] }>;
  };
};

type GoogleMapsWindow = Window & {
  __howManySeatsGoogleMapsReady?: () => void;
  google?: { maps?: { places?: GooglePlacesLibrary } };
};

const FIELD_LABEL = "Address, Postal Code, and City";
const GOOGLE_MAPS_CALLBACK = "__howManySeatsGoogleMapsReady";
const GOOGLE_MAPS_API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY?.trim();
let googlePlacesPromise: Promise<GooglePlacesLibrary> | undefined;

function getGooglePlacesLibrary() {
  return (window as GoogleMapsWindow).google?.maps?.places;
}

function loadGooglePlacesLibrary(apiKey: string): Promise<GooglePlacesLibrary> {
  const library = getGooglePlacesLibrary();
  if (library?.AutocompleteSuggestion) return Promise.resolve(library);
  if (googlePlacesPromise) return googlePlacesPromise;

  googlePlacesPromise = new Promise((resolve, reject) => {
    const mapsWindow = window as GoogleMapsWindow;
    const script = document.createElement("script");
    const params = new URLSearchParams({
      key: apiKey,
      libraries: "places",
      v: "weekly",
      loading: "async",
      auth_referrer_policy: "origin",
      callback: GOOGLE_MAPS_CALLBACK,
    });
    const fail = (message: string) => {
      delete mapsWindow.__howManySeatsGoogleMapsReady;
      googlePlacesPromise = undefined;
      script.remove();
      reject(new Error(message));
    };
    mapsWindow.__howManySeatsGoogleMapsReady = () => {
      const places = getGooglePlacesLibrary();
      if (!places?.AutocompleteSuggestion) {
        fail("Google Maps Places failed to initialize");
        return;
      }
      delete mapsWindow.__howManySeatsGoogleMapsReady;
      resolve(places);
    };
    script.async = true;
    script.src = `https://maps.googleapis.com/maps/api/js?${params}`;
    script.onerror = () => fail("Google Maps JavaScript failed to load");
    document.head.append(script);
  });
  return googlePlacesPromise;
}

export default function AddressField({ mode, onChange, value }: AddressFieldProps) {
  const [mapsReady, setMapsReady] = useState(false);
  const [mapsFailed, setMapsFailed] = useState(false);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [predictions, setPredictions] = useState<GooglePlacePrediction[]>([]);
  const [activeIndex, setActiveIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const sessionRef = useRef<object | undefined>(undefined);
  const revisionRef = useRef(0);
  const selectionRef = useRef(0);

  const isFun = mode === "fun";
  const wrapperClass = isFun
    ? "relative grid min-w-0 gap-2 text-sm font-black uppercase"
    : "relative grid min-w-0 gap-1.5 text-sm font-medium text-neutral-200";
  const inputClass = isFun
    ? "focus-ring h-12 w-full min-w-0 scroll-mt-4 border-4 border-black bg-[#fff8df] px-3 text-base font-black text-black shadow-[6px_6px_0_#111111] placeholder:text-zinc-500"
    : "focus-ring h-10 w-full min-w-0 scroll-mt-4 rounded-md border border-neutral-700 bg-[#1b1b1b] px-3 text-base text-white placeholder:text-neutral-500";
  const panelClass = isFun
    ? "location-suggestions border-4 border-black bg-[#fff8df] text-black shadow-[7px_7px_0_#111111]"
    : "location-suggestions rounded-md border border-neutral-700 bg-[#111111] text-neutral-100 shadow-[0_16px_40px_rgba(0,0,0,0.45)]";
  const optionClass = isFun
    ? "focus-ring block min-h-12 w-full border-b-2 border-black px-3 py-3 text-left text-sm font-black uppercase hover:bg-[#f7e900]"
    : "focus-ring block min-h-12 w-full border-b border-neutral-700 px-3 py-3 text-left text-sm hover:bg-neutral-800";
  const helperClass = isFun
    ? "text-[0.65rem] font-black uppercase tracking-[0.1em]"
    : "text-xs text-neutral-500";

  useEffect(() => {
    if (!GOOGLE_MAPS_API_KEY) return;
    let disposed = false;
    void loadGooglePlacesLibrary(GOOGLE_MAPS_API_KEY)
      .then(() => { if (!disposed) setMapsReady(true); })
      .catch((error: unknown) => {
        if (!disposed) {
          console.error("Google Maps autocomplete failed to load.", error);
          setMapsFailed(true);
        }
      });
    return () => { disposed = true; revisionRef.current++; selectionRef.current++; };
  }, []);

  useEffect(() => {
    if (!open || !mapsReady || mapsFailed || !value.trim()) return;
    const places = getGooglePlacesLibrary();
    if (!places) return;
    const revision = ++revisionRef.current;
    sessionRef.current ??= new places.AutocompleteSessionToken();
    const sessionToken = sessionRef.current;
    setLoading(true);
    const timer = window.setTimeout(() => {
      void places.AutocompleteSuggestion.fetchAutocompleteSuggestions({
        input: value,
        includedRegionCodes: ["ca"],
        language: "en-CA",
        region: "ca",
        sessionToken,
      }).then(({ suggestions }) => {
        if (revision !== revisionRef.current) return;
        setPredictions(suggestions.flatMap(({ placePrediction }) => placePrediction ? [placePrediction] : []));
        setLoading(false);
      }).catch(() => {
        if (revision !== revisionRef.current) return;
        setMapsFailed(true);
        setLoading(false);
        setPredictions([]);
      });
    }, 250);
    return () => { window.clearTimeout(timer); revisionRef.current++; };
  }, [mapsFailed, mapsReady, open, value]);

  // Mobile browsers can pan and resize the visual viewport independently when
  // the keyboard opens. Keep the native input and at least one option above it.
  useEffect(() => {
    if (!open) return;
    const viewport = window.visualViewport;
    let frame = 0;
    function updateSpace() {
      const input = inputRef.current;
      if (!input) return;
      const bottom = (viewport?.offsetTop ?? 0) + (viewport?.height ?? window.innerHeight);
      const available = Math.max(56, bottom - input.getBoundingClientRect().bottom - 16);
      listRef.current?.style.setProperty("--location-suggestions-height", `${available}px`);
    }
    function keepInputVisible() {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const input = inputRef.current;
        if (!input || document.activeElement !== input) return;
        const top = (viewport?.offsetTop ?? 0) + 16;
        const bottom = (viewport?.offsetTop ?? 0) + (viewport?.height ?? window.innerHeight);
        const rect = input.getBoundingClientRect();
        const firstOption = listRef.current?.querySelector('[role="option"]');
        const optionSpace = Math.max(72, (firstOption?.getBoundingClientRect().height ?? 0) + 16);
        const phone = window.matchMedia("(max-width: 639px), (hover: none) and (pointer: coarse)").matches;
        if (rect.top < top || (phone && rect.bottom + optionSpace > bottom)) {
          window.scrollBy({ top: rect.top - top, behavior: "instant" });
        }
        updateSpace();
      });
    }
    keepInputVisible();
    viewport?.addEventListener("resize", keepInputVisible);
    viewport?.addEventListener("scroll", updateSpace);
    window.addEventListener("scroll", updateSpace, { passive: true });
    return () => {
      window.cancelAnimationFrame(frame);
      viewport?.removeEventListener("resize", keepInputVisible);
      viewport?.removeEventListener("scroll", updateSpace);
      window.removeEventListener("scroll", updateSpace);
    };
  }, [open, predictions.length]);

  function closeSuggestions() {
    revisionRef.current++;
    sessionRef.current = undefined;
    setOpen(false);
    setLoading(false);
    setActiveIndex(-1);
    setPredictions([]);
  }

  async function selectPrediction(prediction: GooglePlacePrediction) {
    const selectedValue = prediction.text.toString().replace(/, Canada$/i, "");
    const selection = ++selectionRef.current;
    closeSuggestions();
    sessionRef.current = undefined;
    onChange(selectedValue);
    inputRef.current?.blur();
    try {
      const place = prediction.toPlace();
      await place.fetchFields({ fields: ["formattedAddress", "location"] });
      // Editing, another selection or unmount must supersede a slow response.
      if (selection !== selectionRef.current) return;
      const latitude = place.location?.lat();
      const longitude = place.location?.lng();
      onChange(
        place.formattedAddress?.replace(/, Canada$/i, "") || selectedValue,
        latitude !== undefined && longitude !== undefined ? { latitude, longitude } : undefined,
      );
    } catch {
      // The selected address remains usable by the normal search geocoder.
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Escape") {
      event.preventDefault();
      closeSuggestions();
    } else if (open && predictions.length && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      event.preventDefault();
      const next = event.key === "ArrowDown"
        ? (activeIndex + 1) % predictions.length
        : activeIndex <= 0 ? predictions.length - 1 : activeIndex - 1;
      setActiveIndex(next);
      document.getElementById(`location-suggestion-${next}`)?.scrollIntoView({ block: "nearest" });
    } else if (open && predictions[activeIndex] && event.key === "Enter") {
      event.preventDefault();
      void selectPrediction(predictions[activeIndex]);
    }
  }

  const listVisible = open && mapsReady && !mapsFailed && Boolean(value.trim());
  return (
    <div className={wrapperClass} onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget)) closeSuggestions();
    }}>
      <label htmlFor="location-search">{FIELD_LABEL}</label>
      <input
        aria-autocomplete="list"
        aria-activedescendant={listVisible && activeIndex >= 0 ? `location-suggestion-${activeIndex}` : undefined}
        aria-controls={listVisible ? "location-suggestions" : undefined}
        aria-describedby={GOOGLE_MAPS_API_KEY ? "location-search-help" : undefined}
        aria-expanded={listVisible}
        aria-haspopup="listbox"
        autoComplete="off"
        className={inputClass}
        id="location-search"
        ref={inputRef}
        role="combobox"
        value={value}
        onChange={(event) => {
          revisionRef.current++;
          selectionRef.current++;
          if (!event.target.value.trim()) sessionRef.current = undefined;
          setPredictions([]);
          setActiveIndex(-1);
          setLoading(Boolean(event.target.value.trim()));
          setOpen(true);
          onChange(event.target.value);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
        placeholder="Address, postal code, or city"
        required
      />
      {listVisible ? (
        <div className={panelClass} ref={listRef}>
          <div id="location-suggestions" role="listbox" aria-label="Location suggestions" aria-busy={loading}>
            {predictions.map((prediction, index) => (
              <button
                aria-selected={activeIndex === index}
                className={`${optionClass} ${activeIndex === index ? isFun ? "bg-[#f7e900]" : "bg-neutral-800" : ""}`}
                id={`location-suggestion-${index}`}
                key={prediction.placeId}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => void selectPrediction(prediction)}
                role="option"
                tabIndex={-1}
                type="button"
              >{prediction.text.toString()}</button>
            ))}
          </div>
          {!predictions.length ? <p className="px-3 py-3 text-xs" role="status">{loading ? "Finding locations…" : "No suggestions. You can enter the address manually."}</p> : null}
          <div className="flex justify-end px-3 pb-2 pt-3">
            {/* Official attribution asset; never inherit the fun theme's case. */}
            <img alt="Google Maps" className="h-4 w-auto" height="16" src={isFun ? "/google-maps-black.svg" : "/google-maps-white.svg"} />
          </div>
        </div>
      ) : null}
      {GOOGLE_MAPS_API_KEY ? <span id="location-search-help" className={helperClass}>
        {mapsFailed ? "Google Maps suggestions are unavailable. Enter the address manually." : mapsReady ? "Address suggestions from Google Maps" : "Loading address suggestions from Google Maps"}
      </span> : null}
    </div>
  );
}
