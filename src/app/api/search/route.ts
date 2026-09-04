import { NextResponse } from "next/server";
import { z } from "zod";
import { CinemaSearch } from "@/lib/cinema-search";
import { CineplexClient } from "@/lib/cineplex-client";
import { parseShowtimeExperienceTypes } from "@/lib/experience-types";
import {
  searchAreaSchema,
  searchParamsToRecord,
  validateSearchArea,
} from "@/lib/search-request";

export const maxDuration = 60;
export const runtime = "edge";

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
    const search = await new CinemaSearch([
      { client: new CineplexClient(), provider: "cineplex" },
    ]).search({
      ...parsed.data,
      endDate: parsed.data.endDate ?? parsed.data.date,
    });

    return NextResponse.json(search);
  } catch (error) {
    console.error("Cinema search request failed", error);

    return NextResponse.json(
      {
        error: "Cinema search is temporarily unavailable. Try again.",
      },
      { status: 502 },
    );
  }
}
