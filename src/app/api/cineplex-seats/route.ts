import { NextResponse } from "next/server";
import { z } from "zod";
import { CineplexClient } from "@/lib/cineplex-client";

export const maxDuration = 60;
export const runtime = "edge";

const seatRequestSchema = z.object({
  requests: z
    .array(
      z.object({
        resultId: z.string().min(1).max(160),
        showtimeId: z.string().regex(/^\d+$/).max(20),
        theatreId: z.string().regex(/^\d+$/).max(20),
      }),
    )
    .min(1)
    .max(40),
});

export async function POST(request: Request) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Send a valid seat request." },
      { status: 400 },
    );
  }

  const parsed = seatRequestSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Send between 1 and 40 valid Cineplex showtimes." },
      { status: 400 },
    );
  }

  try {
    const snapshots = await new CineplexClient().getSeatSnapshots(
      parsed.data.requests,
    );

    return NextResponse.json(snapshots);
  } catch (error) {
    console.error("Cineplex seat batch failed", error);

    return NextResponse.json(
      { error: "Cineplex seat counts are temporarily unavailable." },
      { status: 502 },
    );
  }
}
