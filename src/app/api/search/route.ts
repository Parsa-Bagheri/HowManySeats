import { NextResponse } from "next/server";
import { z } from "zod";
import { CineplexClient } from "@/lib/cineplex-client";
import { getSearchDates, isValidDateInput } from "@/lib/date-range";
import { parseShowtimeExperienceTypes } from "@/lib/experience-types";
import type { SearchResult } from "@/lib/types";

const booleanParam = z
  .enum(["true", "false"])
  .transform((value) => value === "true")
  .optional();

const searchSchema = z.object({
  location: z.string().min(1),
  date: z.string().refine(isValidDateInput),
  endDate: z.string().refine(isValidDateInput).optional(),
  radiusKm: z.coerce.number().min(1).max(250),
  latitude: z.coerce.number().min(-90).max(90).optional(),
  longitude: z.coerce.number().min(-180).max(180).optional(),
  movieTitle: z.string().optional(),
  experienceTypes: z
    .string()
    .optional()
    .transform((value) => parseShowtimeExperienceTypes(value ? [value] : [])),
  onlyZeroSold: booleanParam,
  maxFiveSold: booleanParam,
  startsInNextTwoHours: booleanParam,
  nonVipOnly: booleanParam,
  accessibleAvailable: booleanParam,
  sortBy: z.enum(["distance-asc", "distance-desc", "time-asc", "time-desc"]).optional()
});

export async function GET(request: Request) {
  const url = new URL(request.url);
  const parsed = searchSchema.safeParse(Object.fromEntries(url.searchParams.entries()));

  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Invalid search query",
        issues: parsed.error.flatten()
      },
      { status: 400 }
    );
  }

  const hasCompleteCoordinates =
    (parsed.data.latitude === undefined && parsed.data.longitude === undefined) ||
    (parsed.data.latitude !== undefined && parsed.data.longitude !== undefined);
  const dates = getSearchDates(parsed.data.date, parsed.data.endDate ?? parsed.data.date);

  if (!dates || !hasCompleteCoordinates) {
    return NextResponse.json(
      {
        error: "Invalid search query",
        issues: {
          dateRange: dates ? undefined : "Date range must contain one to three inclusive days.",
          coordinates: hasCompleteCoordinates ? undefined : "Latitude and longitude must be provided together."
        }
      },
      { status: 400 }
    );
  }

  try {
    const results = await new CineplexClient().search({
      ...parsed.data,
      endDate: parsed.data.endDate ?? parsed.data.date
    });

    return NextResponse.json({ results: results.map(toUiResult) });
  } catch (error) {
    console.error("Live Cineplex search failed", error);

    return NextResponse.json(
      {
        error: "Live Cineplex search failed"
      },
      { status: 502 }
    );
  }
}

function toUiResult(result: SearchResult): SearchResult {
  return {
    ...result,
    snapshot: {
      ...result.snapshot,
      rawSnapshot: summarizeRawSnapshot(result.snapshot.rawSnapshot)
    }
  };
}

function summarizeRawSnapshot(rawSnapshot: unknown) {
  if (
    rawSnapshot &&
    typeof rawSnapshot === "object" &&
    "counts" in rawSnapshot &&
    typeof rawSnapshot.counts === "object"
  ) {
    return { counts: rawSnapshot.counts };
  }

  return undefined;
}
