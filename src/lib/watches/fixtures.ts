import type { SearchCandidate } from "../types";
import { buildSeatSnapshot } from "../seat-scoring";
import { CollectionError, type Collector } from "./model";

// Synthetic provider-shaped replay data. No request goes to a cinema in fixture mode.
export function fixtureScreening(showtimeId = "900001", now = Date.now()): SearchCandidate {
  return {
    theatre: { id: "cineplex-7402", provider: "cineplex", providerTheatreId: "7402", name: "Fixture Cinema Waterloo", city: "Waterloo", province: "ON", timeZone: "America/Toronto" },
    showtime: { id: `cineplex-7402-${showtimeId}`, providerShowtimeId: showtimeId, theatreId: "cineplex-7402", movieTitle: "Background Watch Demo", startsAt: new Date(now + 24 * 60 * 60_000).toISOString(), format: "Regular", seatPreviewUrl: `https://www.cineplex.com/en-Mobile/ticketing/preview?theatreId=7402&showtimeId=${showtimeId}` },
  };
}
export const fixtureCollector: Collector = async (screening) => {
  await new Promise((resolve) => setTimeout(resolve, 20));
  const id = screening.showtime.providerShowtimeId;
  if (id === "900003") throw new CollectionError("timeout", "Cineplex did not respond before the deadline.", true);
  if (id === "900004") throw new CollectionError("rate-limited", "Cineplex limited this refresh. A retry is scheduled.", true);
  if (id === "900005") throw new CollectionError("malformed", "Cineplex returned an invalid seat map.", false);
  const snapshot = buildSeatSnapshot([
    ...Array.from({ length: 36 }, () => ({ type: "Standard", status: "Available" })),
    ...Array.from({ length: 4 }, () => ({ type: "Standard", status: "Occupied" })),
    { type: "Wheelchair", status: "Available" }, { type: "Wheelchair", status: "Reserved" },
    { type: "Companion", status: "Available" }, { type: "Companion", status: "Sold" },
    { type: "Standard", status: "Broken" },
    ...(id === "900002" ? [{ type: "Standard", status: "Mystery" }] : []),
  ]);
  return { ...snapshot, unknownSeats: snapshot.unknownSeats ?? 0, excludedSeats: snapshot.excludedSeats ?? 0, partial: Boolean(snapshot.unknownSeats) };
};
