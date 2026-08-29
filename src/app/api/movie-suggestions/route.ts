import { NextResponse } from "next/server";
import { z } from "zod";
import { CineplexClient } from "@/lib/cineplex-client";
import { getSearchDates, isValidDateInput } from "@/lib/date-range";

const suggestionSchema = z.object({
  location: z.string().min(1),
  date: z.string().refine(isValidDateInput),
  endDate: z.string().refine(isValidDateInput).optional(),
  radiusKm: z.coerce.number().min(1).max(250),
  latitude: z.coerce.number().min(-90).max(90).optional(),
  longitude: z.coerce.number().min(-180).max(180).optional(),
  query: z.string().min(2).max(120),
  limit: z.coerce.number().int().min(1).max(12).optional()
});

export async function GET(request: Request) {
  const url = new URL(request.url);
  const parsed = suggestionSchema.safeParse(Object.fromEntries(url.searchParams.entries()));

  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Invalid suggestion query",
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
    return NextResponse.json({ error: "Invalid suggestion query" }, { status: 400 });
  }

  try {
    const suggestions = await new CineplexClient().suggestMovieTitles({
      location: parsed.data.location,
      date: parsed.data.date,
      endDate: parsed.data.endDate ?? parsed.data.date,
      radiusKm: parsed.data.radiusKm,
      latitude: parsed.data.latitude,
      longitude: parsed.data.longitude,
      movieTitle: parsed.data.query,
      limit: parsed.data.limit
    });

    return NextResponse.json({ suggestions });
  } catch (error) {
    console.error("Live Cineplex movie suggestions failed", error);

    return NextResponse.json(
      {
        error: "Live Cineplex movie suggestions failed"
      },
      { status: 502 }
    );
  }
}
