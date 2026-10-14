import { CineplexClient } from "../cineplex-client";
import { CollectionError, type Collector } from "./model";

export const cineplexCollector: Collector = async (screening) => {
  try {
    const seats = await new CineplexClient().getSeatSnapshot(screening.theatre, screening.showtime);
    const unknownSeats = seats.unknownSeats ?? 0;
    return { ...seats, unknownSeats, excludedSeats: seats.excludedSeats ?? 0, partial: unknownSeats > 0 };
  } catch (error) {
    const text = error instanceof Error ? error.message : "";
    if (/429/.test(text)) throw new CollectionError("rate-limited", "Cineplex limited this refresh. A retry is scheduled.", true);
    if (/404|410/.test(text)) throw new CollectionError("screening-unavailable", "This screening is no longer available from Cineplex.", false);
    if (/invalid JSON|malformed|Cannot read|not iterable/.test(text)) throw new CollectionError("malformed", "Cineplex returned an invalid seat map.", false);
    if (/abort|timeout/i.test(text)) throw new CollectionError("timeout", "Cineplex did not respond before the deadline.", true);
    throw new CollectionError("provider-unavailable", "Cineplex is temporarily unavailable.", true);
  }
};
