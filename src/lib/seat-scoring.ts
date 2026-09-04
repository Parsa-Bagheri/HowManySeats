import type { RawSeat, SeatSnapshot } from "./types";

const OCCUPIED_SEAT_STATUSES = new Set(["occupied", "sold", "held", "reserved"]);

type SeatCategory = "standard" | "accessible" | "companion";

export function buildSeatSnapshot(
  rawSeats: RawSeat[],
  checkedAt = new Date(),
): SeatSnapshot {
  let sellableSeats = 0;
  let occupiedEstimate = 0;
  let accessibleSeats = 0;
  let occupiedAccessibleSeats = 0;
  let companionSeats = 0;
  let occupiedCompanionSeats = 0;

  for (const seat of rawSeats) {
    const status = seat.status?.trim().toLowerCase();
    const category = getSeatCategory(seat.type);
    const occupied = Boolean(status && OCCUPIED_SEAT_STATUSES.has(status));

    if (status !== "available" && !occupied) {
      continue;
    }

    if (category === "accessible") {
      accessibleSeats += 1;
      if (occupied) {
        occupiedAccessibleSeats += 1;
      }
    } else if (category === "companion") {
      companionSeats += 1;
      if (occupied) {
        occupiedCompanionSeats += 1;
      }
    } else {
      sellableSeats += 1;
      if (occupied) {
        occupiedEstimate += 1;
      }
    }
  }

  return {
    checkedAt: checkedAt.toISOString(),
    sellableSeats,
    occupiedEstimate,
    accessibleSeats,
    occupiedAccessibleSeats,
    companionSeats,
    occupiedCompanionSeats,
    accessibilityCount: accessibleSeats + companionSeats,
  };
}

function getSeatCategory(type: string | undefined): SeatCategory {
  switch (type?.trim().toLowerCase()) {
    case "wheelchair":
      return "accessible";
    case "companion":
      return "companion";
    default:
      return "standard";
  }
}
