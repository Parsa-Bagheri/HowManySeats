"use client";

import { useEffect, useRef, useState } from "react";
import type { UiMode } from "@/lib/ui-mode";

export type LocationCoordinates = {
  latitude: number;
  longitude: number;
};

type AddressFieldProps = {
  mode: UiMode;
  onChange: (value: string, coordinates?: LocationCoordinates) => void;
  value: string;
};

type GoogleLatLng = {
  lat: () => number;
  lng: () => number;
};

type GooglePlace = {
  fetchFields: (request: { fields: string[] }) => Promise<void>;
  formattedAddress?: string;
  location?: GoogleLatLng;
};

type GooglePlacePrediction = {
  toPlace: () => GooglePlace;
};

type GooglePlaceSelectEvent = Event & {
  placePrediction?: GooglePlacePrediction;
};

type GooglePlaceAutocompleteElement = HTMLElement & {
  description: string;
  includedRegionCodes: string[];
  placeholder: string;
  requestedLanguage: string;
  requestedRegion: string;
  value: string;
};

type GooglePlacesLibrary = {
  PlaceAutocompleteElement: new (
    options?: Record<string, unknown>,
  ) => GooglePlaceAutocompleteElement;
};

type GoogleMapsWindow = Window & {
  __howManySeatsGoogleMapsReady?: () => void;
  google?: {
    maps?: {
      places?: GooglePlacesLibrary;
    };
  };
};

const FIELD_LABEL = "Address, Postal Code, and City";
const FIELD_LABEL_ID = "location-search-label";
const GOOGLE_MAPS_CALLBACK = "__howManySeatsGoogleMapsReady";
const GOOGLE_MAPS_API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY?.trim();
let googlePlacesPromise: Promise<GooglePlacesLibrary> | undefined;

function getGooglePlacesLibrary(): GooglePlacesLibrary | undefined {
  return (window as GoogleMapsWindow).google?.maps?.places;
}

function loadGooglePlacesLibrary(apiKey: string): Promise<GooglePlacesLibrary> {
  const loadedLibrary = getGooglePlacesLibrary();

  if (loadedLibrary?.PlaceAutocompleteElement) {
    return Promise.resolve(loadedLibrary);
  }

  if (googlePlacesPromise) {
    return googlePlacesPromise;
  }

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
      const library = getGooglePlacesLibrary();

      if (!library?.PlaceAutocompleteElement) {
        fail("Google Maps Places failed to initialize");
        return;
      }

      delete mapsWindow.__howManySeatsGoogleMapsReady;
      resolve(library);
    };

    script.async = true;
    script.src = `https://maps.googleapis.com/maps/api/js?${params}`;
    script.onerror = () => fail("Google Maps JavaScript failed to load");
    document.head.append(script);
  });

  return googlePlacesPromise;
}

export default function AddressField({
  mode,
  onChange,
  value,
}: AddressFieldProps) {
  const [mapsReady, setMapsReady] = useState(false);
  const [mapsFailed, setMapsFailed] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const autocompleteRef = useRef<GooglePlaceAutocompleteElement | null>(null);
  const valueRef = useRef(value);
  valueRef.current = value;

  const isFun = mode === "fun";
  const wrapperClass = isFun
    ? "grid gap-2 text-sm font-black uppercase"
    : "grid gap-1.5 text-sm font-medium text-neutral-200";
  const fallbackInputClass = isFun
    ? "focus-ring h-12 w-full border-4 border-black bg-[#fff8df] px-3 text-base font-black text-black shadow-[6px_6px_0_#111111] transition placeholder:text-zinc-500 focus:-translate-y-0.5 focus:shadow-[8px_8px_0_#111111]"
    : "focus-ring h-10 rounded-md border border-neutral-700 bg-[#1b1b1b] px-3 text-base text-white placeholder:text-neutral-500";
  const helperClass = isFun
    ? "text-[0.65rem] font-black uppercase tracking-[0.1em]"
    : "text-xs text-neutral-500";

  useEffect(() => {
    if (!GOOGLE_MAPS_API_KEY) {
      return;
    }

    let disposed = false;

    void loadGooglePlacesLibrary(GOOGLE_MAPS_API_KEY)
      .then(() => {
        if (!disposed) {
          setMapsReady(true);
        }
      })
      .catch((error: unknown) => {
        if (!disposed) {
          console.error("Google Maps autocomplete failed to load.", error);
          setMapsFailed(true);
        }
      });

    return () => {
      disposed = true;
    };
  }, []);

  useEffect(() => {
    if (!mapsReady || mapsFailed || !containerRef.current) {
      return;
    }

    let disposed = false;
    let autocomplete: GooglePlaceAutocompleteElement | undefined;

    function initializeAutocomplete() {
      try {
        const places = getGooglePlacesLibrary();

        if (!places?.PlaceAutocompleteElement) {
          throw new Error("Google Maps failed to initialize");
        }

        autocomplete = new places.PlaceAutocompleteElement({
          includedRegionCodes: ["ca"],
          value: valueRef.current,
        });
        autocomplete.className = `google-address-autocomplete google-address-autocomplete-${mode}`;
        autocomplete.description = FIELD_LABEL;
        autocomplete.placeholder =
          "Enter a Canadian address, postal code, or city";
        autocomplete.requestedLanguage = "en-CA";
        autocomplete.requestedRegion = "ca";
        autocomplete.setAttribute("aria-labelledby", FIELD_LABEL_ID);

        const syncManualValue = () => {
          if (autocomplete) {
            onChange(autocomplete.value);
          }
        };
        const handleError = (event: Event) => {
          console.error("Google Maps autocomplete request failed.", event);
          setMapsFailed(true);
        };
        const handleSelection = async (event: Event) => {
          const placePrediction = (event as GooglePlaceSelectEvent)
            .placePrediction;

          if (!placePrediction || !autocomplete) {
            return;
          }

          try {
            const place = placePrediction.toPlace();
            await place.fetchFields({
              fields: ["formattedAddress", "location"],
            });

            if (disposed) {
              return;
            }

            const nextValue =
              place.formattedAddress?.replace(/, Canada$/i, "") ||
              autocomplete.value;
            const latitude = place.location?.lat();
            const longitude = place.location?.lng();
            const coordinates =
              latitude !== undefined && longitude !== undefined
                ? { latitude, longitude }
                : undefined;

            autocomplete.value = nextValue;
            onChange(nextValue, coordinates);
          } catch {
            syncManualValue();
          }
        };

        autocomplete.addEventListener("input", syncManualValue);
        autocomplete.addEventListener("change", syncManualValue);
        autocomplete.addEventListener("focusout", syncManualValue);
        autocomplete.addEventListener("gmp-error", handleError);
        autocomplete.addEventListener("gmp-select", handleSelection);

        if (disposed || !containerRef.current) {
          return;
        }

        containerRef.current.replaceChildren(autocomplete);
        autocompleteRef.current = autocomplete;
      } catch (error) {
        if (!disposed) {
          console.error(
            "Google Maps autocomplete failed to initialize.",
            error,
          );
          setMapsFailed(true);
        }
      }
    }

    initializeAutocomplete();

    return () => {
      disposed = true;
      autocomplete?.remove();
      autocompleteRef.current = null;
    };
  }, [mapsFailed, mapsReady, mode, onChange]);

  useEffect(() => {
    if (autocompleteRef.current && autocompleteRef.current.value !== value) {
      autocompleteRef.current.value = value;
    }
  }, [value]);

  const showGoogleAutocomplete = Boolean(
    GOOGLE_MAPS_API_KEY && mapsReady && !mapsFailed,
  );

  return (
    <div className={wrapperClass}>
      {showGoogleAutocomplete ? (
        <span id={FIELD_LABEL_ID}>{FIELD_LABEL}</span>
      ) : (
        <label id={FIELD_LABEL_ID} htmlFor="location-search">
          {FIELD_LABEL}
        </label>
      )}
      {showGoogleAutocomplete ? (
        <div ref={containerRef} className="min-w-0" />
      ) : (
        <input
          autoComplete="street-address"
          className={fallbackInputClass}
          id="location-search"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="Address, postal code, or city"
          required
        />
      )}
      {GOOGLE_MAPS_API_KEY ? (
        <span className={helperClass}>
          {mapsFailed
            ? "Google Maps suggestions are unavailable. Enter the address manually."
            : mapsReady
              ? "Address suggestions from Google Maps"
              : "Loading address suggestions from Google Maps"}
        </span>
      ) : null}
    </div>
  );
}
