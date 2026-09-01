import { NextResponse } from "next/server";
import { z } from "zod";
import { CineplexClient } from "@/lib/cineplex-client";
import { parseShowtimeExperienceTypes } from "@/lib/experience-types";
import {
  searchAreaSchema,
  searchParamsToRecord,
  validateSearchArea,
} from "@/lib/search-request";
import type { SearchResult } from "@/lib/types";

const booleanParam = z
  .enum(["true", "false"])
  .transform((value) => value === "true")
  .optional();

const searchSchema = searchAreaSchema.extend({
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
  sortBy: z
    .enum(["distance-asc", "distance-desc", "time-asc", "time-desc"])
    .optional(),
});

export async function GET(request: Request) {
  const url = new URL(request.url);
  const parsed = searchSchema.safeParse(searchParamsToRecord(url.searchParams));

  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Check the search fields and try again.",
        issues: parsed.error.flatten(),
      },
      { status: 400 },
    );
  }

  const validation = validateSearchArea(parsed.data);

  if (!validation.isValid) {
    return NextResponse.json(
      {
        error: "Check the search fields and try again.",
        issues: validation.issues,
      },
      { status: 400 },
    );
  }

  try {
    const results = await new CineplexClient().search({
      ...parsed.data,
      endDate: parsed.data.endDate ?? parsed.data.date,
    });

    return NextResponse.json({ results: results.map(toUiResult) });
  } catch (error) {
    console.error("Cineplex search request failed", error);

    return NextResponse.json(
      {
        error: "Cineplex search is temporarily unavailable. Try again.",
      },
      { status: 502 },
    );
  }
}

function toUiResult(result: SearchResult): SearchResult {
  return {
    ...result,
    snapshot: {
      ...result.snapshot,
      rawSnapshot: summarizeRawSnapshot(result.snapshot.rawSnapshot),
    },
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
