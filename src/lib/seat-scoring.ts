import type { RawSeat, SeatSnapshot } from "./types";

const ACCESSIBLE_SEAT_TYPES = new Set(["wheelchair", "companion"]);
const OCCUPIED_SEAT_STATUSES = new Set(["occupied", "sold", "held", "reserved"]);

export function buildSeatSnapshot(
  rawSeats: RawSeat[],
  checkedAt = new Date(),
): SeatSnapshot {
  let sellableSeats = 0;
  let occupiedEstimate = 0;
  let accessibilityCount = 0;

  for (const seat of rawSeats) {
    const type = seat.type?.trim().toLowerCase();

    if (type && ACCESSIBLE_SEAT_TYPES.has(type)) {
      accessibilityCount += 1;
      continue;
    }

    const status = seat.status?.trim().toLowerCase();

    if (status === "available") {
      sellableSeats += 1;
    } else if (status && OCCUPIED_SEAT_STATUSES.has(status)) {
      sellableSeats += 1;
      occupiedEstimate += 1;
    }
  }

  return {
    checkedAt: checkedAt.toISOString(),
    sellableSeats,
    occupiedEstimate,
    accessibilityCount,
  };
}
