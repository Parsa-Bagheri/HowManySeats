import { NextResponse } from "next/server";
import { z } from "zod";
import { CinemaSearch } from "@/lib/cinema-search";
import { CineplexClient } from "@/lib/cineplex-client";
import {
  searchAreaSchema,
  searchParamsToRecord,
  validateSearchArea,
} from "@/lib/search-request";

export const maxDuration = 60;
export const runtime = "edge";

const suggestionSchema = searchAreaSchema.extend({
  query: z.string().min(2).max(120),
  limit: z.coerce.number().int().min(1).max(12).optional(),
});

export async function GET(request: Request) {
  const url = new URL(request.url);
  const parsed = suggestionSchema.safeParse(
    searchParamsToRecord(url.searchParams),
  );

  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Check the movie title and search fields, then try again.",
        issues: parsed.error.flatten(),
      },
      { status: 400 },
    );
  }

  const validation = validateSearchArea(parsed.data);

  if (!validation.isValid) {
    return NextResponse.json(
      {
        error: "Check the movie title and search fields, then try again.",
        issues: validation.issues,
      },
      { status: 400 },
    );
  }

  try {
    const suggestions = await new CinemaSearch([
      { client: new CineplexClient(), provider: "cineplex" },
    ]).suggestMovieTitles({
      location: parsed.data.location,
      date: parsed.data.date,
      endDate: parsed.data.endDate ?? parsed.data.date,
      radiusKm: parsed.data.radiusKm,
      latitude: parsed.data.latitude,
      longitude: parsed.data.longitude,
      movieTitle: parsed.data.query,
      limit: parsed.data.limit,
    });

    return NextResponse.json({ suggestions });
  } catch (error) {
    console.error("Movie suggestion request failed", error);

    return NextResponse.json(
      {
        error: "Movie suggestions are temporarily unavailable. Try again.",
      },
      { status: 502 },
    );
  }
}
