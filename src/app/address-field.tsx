"use client";

import Script from "next/script";
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
  google?: {
    maps?: {
      importLibrary: (library: string) => Promise<unknown>;
    };
  };
};

const FIELD_LABEL = "Address, Postal Code, and City";
const FIELD_LABEL_ID = "location-search-label";
const GOOGLE_MAPS_API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY?.trim();

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
  const mapsScriptUrl = GOOGLE_MAPS_API_KEY
    ? `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(GOOGLE_MAPS_API_KEY)}&libraries=places&v=weekly&auth_referrer_policy=origin`
    : undefined;

  useEffect(() => {
    if (!mapsReady || mapsFailed || !containerRef.current) {
      return;
    }

    let disposed = false;
    let autocomplete: GooglePlaceAutocompleteElement | undefined;

    async function initializeAutocomplete() {
      try {
        const maps = (window as GoogleMapsWindow).google?.maps;

        if (!maps) {
          throw new Error("Google Maps failed to initialize");
        }

        const { PlaceAutocompleteElement } = (await maps.importLibrary(
          "places",
        )) as GooglePlacesLibrary;
        autocomplete = new PlaceAutocompleteElement({
          includedRegionCodes: ["ca"],
          value: valueRef.current,
        });
        autocomplete.className = `google-address-autocomplete google-address-autocomplete-${mode}`;
        autocomplete.description = FIELD_LABEL;
        autocomplete.placeholder =
          "Enter a Canadian address, postal code, or city";
        autocomplete.includedRegionCodes = ["ca"];
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

    void initializeAutocomplete();

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
      {mapsScriptUrl ? (
        <Script
          id="google-maps-places"
          src={mapsScriptUrl}
          strategy="afterInteractive"
          onLoad={() => setMapsReady(true)}
          onReady={() => setMapsReady(true)}
          onError={(error) => {
            console.error("Google Maps JavaScript failed to load.", error);
            setMapsFailed(true);
          }}
        />
      ) : null}
    </div>
  );
}
