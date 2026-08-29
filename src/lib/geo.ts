export type Coordinates = {
  latitude: number;
  longitude: number;
};

type KnownLocation = Coordinates & {
  match: RegExp;
};

type NominatimResult = {
  lat?: string;
  lon?: string;
};

type ZippopotamusResult = {
  places?: Array<{
    latitude?: string;
    longitude?: string;
  }>;
};

const KNOWN_LOCATIONS: KnownLocation[] = [
  { match: /\b(toronto|yonge|dundas)\b/i, latitude: 43.6532, longitude: -79.3832 },
  { match: /\bwaterloo\b/i, latitude: 43.4643, longitude: -80.5204 },
  { match: /\bkitchener\b/i, latitude: 43.4516, longitude: -80.4925 },
  { match: /\bcambridge\b/i, latitude: 43.3616, longitude: -80.3144 },
  { match: /\bottawa\b/i, latitude: 45.4215, longitude: -75.6972 },
  { match: /\bvancouver\b/i, latitude: 49.2827, longitude: -123.1207 },
  { match: /\bsurrey\b/i, latitude: 49.1044, longitude: -122.8011 },
  { match: /\bcalgary\b/i, latitude: 51.0447, longitude: -114.0719 },
  { match: /\bmontreal\b/i, latitude: 45.5019, longitude: -73.5674 }
];

const FSA_FALLBACKS: Record<string, Coordinates> = {
  M5V: { latitude: 43.6426, longitude: -79.3871 },
  N2L: { latitude: 43.4731, longitude: -80.537 },
  V3Z: { latitude: 49.0539, longitude: -122.7845 }
};

const PROVINCE_CODES: Record<string, string> = {
  ab: "AB",
  alberta: "AB",
  bc: "BC",
  "british columbia": "BC",
  mb: "MB",
  manitoba: "MB",
  nb: "NB",
  "new brunswick": "NB",
  nl: "NL",
  "newfoundland and labrador": "NL",
  ns: "NS",
  "nova scotia": "NS",
  nt: "NT",
  "northwest territories": "NT",
  nu: "NU",
  nunavut: "NU",
  on: "ON",
  ontario: "ON",
  pe: "PE",
  "prince edward island": "PE",
  qc: "QC",
  quebec: "QC",
  sk: "SK",
  saskatchewan: "SK",
  yt: "YT",
  yukon: "YT"
};

const geocodeCache = new Map<string, Coordinates | undefined>();

export async function resolveLocation(input: string): Promise<Coordinates | undefined> {
  const normalized = normalizeLocationInput(input);

  if (!normalized || getProvinceCode(normalized)) {
    return undefined;
  }

  const cacheKey = normalized.toLowerCase();

  if (geocodeCache.has(cacheKey)) {
    return geocodeCache.get(cacheKey);
  }

  const fallback = resolveKnownLocation(normalized);
  const coordinates = isCanadianPostalInput(normalized)
    ? (await geocodeCanadianLocation(normalized)) ?? (await geocodeCanadianPostalArea(normalized)) ?? fallback
    : fallback ?? (await geocodeCanadianLocation(normalized));

  geocodeCache.set(cacheKey, coordinates);
  return coordinates;
}

export function getProvinceCode(input: string): string | undefined {
  return PROVINCE_CODES[normalizeLocationInput(input).toLowerCase()];
}

function resolveKnownLocation(input: string): Coordinates | undefined {
  const normalized = normalizeLocationInput(input);
  const fsa = extractForwardSortationArea(normalized);
  const location = KNOWN_LOCATIONS.find((item) => item.match.test(normalized));

  if (location) {
    return { latitude: location.latitude, longitude: location.longitude };
  }

  return fsa ? FSA_FALLBACKS[fsa] : undefined;
}

export function distanceKm(a: Coordinates, b: Coordinates): number {
  const radius = 6371;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);

  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);

  return 2 * radius * Math.asin(Math.sqrt(h));
}

function toRad(value: number): number {
  return (value * Math.PI) / 180;
}

function normalizeLocationInput(input: string): string {
  return input.trim().replace(/\s+/g, " ");
}

function isCanadianPostalInput(input: string): boolean {
  return /^[A-Z][0-9][A-Z](?:\s?[0-9][A-Z][0-9])?$/i.test(input.trim());
}

function extractForwardSortationArea(input: string): string | undefined {
  const compact = input.replace(/\s+/g, "").toUpperCase();

  if (/^[A-Z][0-9][A-Z]([0-9][A-Z][0-9])?$/.test(compact)) {
    return compact.slice(0, 3);
  }

  return undefined;
}

async function geocodeCanadianLocation(input: string): Promise<Coordinates | undefined> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3500);

  try {
    const url = buildNominatimUrl(input);
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "Accept-Language": "en-CA,en;q=0.9",
        "User-Agent": "how-many-seats/0.1 local-search"
      },
      signal: controller.signal,
      cache: "force-cache"
    });

    if (!response.ok) {
      return undefined;
    }

    const data = (await response.json()) as NominatimResult[];
    const first = data[0];
    const latitude = Number(first?.lat);
    const longitude = Number(first?.lon);

    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return undefined;
    }

    return { latitude, longitude };
  } catch {
    return undefined;
  } finally {
    clearTimeout(timeout);
  }
}

async function geocodeCanadianPostalArea(input: string): Promise<Coordinates | undefined> {
  const fsa = extractForwardSortationArea(input);

  if (!fsa) {
    return undefined;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3500);

  try {
    const response = await fetch(`https://api.zippopotam.us/ca/${encodeURIComponent(fsa)}`, {
      headers: {
        Accept: "application/json"
      },
      signal: controller.signal,
      cache: "force-cache"
    });

    if (!response.ok) {
      return undefined;
    }

    const data = (await response.json()) as ZippopotamusResult;
    const first = data.places?.[0];
    const latitude = Number(first?.latitude);
    const longitude = Number(first?.longitude);

    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return undefined;
    }

    return { latitude, longitude };
  } catch {
    return undefined;
  } finally {
    clearTimeout(timeout);
  }
}

function buildNominatimUrl(input: string): string {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  const fsa = extractForwardSortationArea(input);

  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "1");
  url.searchParams.set("countrycodes", "ca");
  url.searchParams.set("addressdetails", "1");

  if (fsa) {
    const compact = input.replace(/\s+/g, "").toUpperCase();
    const postalCode = compact.length === 6 ? `${compact.slice(0, 3)} ${compact.slice(3)}` : fsa;
    url.searchParams.set("postalcode", postalCode);
  } else {
    url.searchParams.set("q", `${input}, Canada`);
  }

  return url.toString();
}
