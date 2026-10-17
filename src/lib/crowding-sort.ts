import type { SearchCandidate, SeatSnapshot } from "./types";

type SortableShowtime = Pick<
  SearchCandidate,
  "showtime" | "distanceKm" | "snapshot"
>;

/** Discovery and hydration order cannot infer crowding before a seat check. */
export function compareUncheckedShowtimes(
  a: SortableShowtime,
  b: SortableShowtime,
): number {
  return (
    new Date(a.showtime.startsAt).getTime() -
      new Date(b.showtime.startsAt).getTime() ||
    compareKnownNumbers(a.distanceKm, b.distanceKm) ||
    a.showtime.id.localeCompare(b.showtime.id)
  );
}

/** Standard-seat counts already exclude accessible and companion seating. */
export function compareCheckedCrowding(
  a: SortableShowtime,
  b: SortableShowtime,
): number {
  return (
    compareKnownNumbers(occupancyRatio(a.snapshot), occupancyRatio(b.snapshot)) ||
    compareKnownNumbers(
      a.snapshot?.occupiedEstimate,
      b.snapshot?.occupiedEstimate,
    ) ||
    compareUncheckedShowtimes(a, b)
  );
}

function occupancyRatio(snapshot: SeatSnapshot | undefined): number | undefined {
  if (
    !snapshot ||
    !Number.isFinite(snapshot.sellableSeats) ||
    snapshot.sellableSeats <= 0 ||
    !Number.isFinite(snapshot.occupiedEstimate) ||
    snapshot.occupiedEstimate < 0 ||
    snapshot.occupiedEstimate > snapshot.sellableSeats
  ) {
    return undefined;
  }
  return snapshot.occupiedEstimate / snapshot.sellableSeats;
}

function compareKnownNumbers(a: number | undefined, b: number | undefined): number {
  const aKnown = a !== undefined && Number.isFinite(a);
  const bKnown = b !== undefined && Number.isFinite(b);
  if (!aKnown || !bKnown) {
    return aKnown ? -1 : bKnown ? 1 : 0;
  }
  return (a ?? 0) - (b ?? 0);
}
