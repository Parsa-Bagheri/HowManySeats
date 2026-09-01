import type { Confidence, RawSeat, SeatSnapshot, SeatStatus } from "./types";

const STATUS_KEYWORDS: Array<[SeatStatus, RegExp]> = [
  ["wheelchair", /\b(wheelchair|accessible|mobility)\b/i],
  ["companion", /\b(companion|support person)\b/i],
  ["sold", /\b(sold|occupied|taken|unavailable sold)\b/i],
  [
    "reserved",
    /\b(reserved|held|hold|selected|selected by another|temporarily)\b/i,
  ],
  [
    "blocked",
    /\b(blocked|house|broken|closed|unavailable|not selectable|aisle)\b/i,
  ],
  ["available", /\b(available|open|selectable)\b/i],
];

function classifySeatStatus(rawSeat: RawSeat): SeatStatus {
  const text = [
    rawSeat.status,
    rawSeat.type,
    rawSeat.ariaLabel,
    rawSeat.className,
    rawSeat.label,
    rawSeat.disabled === true ? "disabled" : "",
    rawSeat.selectable === true ? "selectable available" : "",
  ]
    .filter(Boolean)
    .join(" ");

  for (const [status, pattern] of STATUS_KEYWORDS) {
    if (pattern.test(text)) {
      return status;
    }
  }

  return "unknown";
}

function scoreShowing(
  snapshot: Pick<SeatSnapshot, "occupiedEstimate" | "unknownCount">,
): Confidence {
  if (snapshot.occupiedEstimate === 0 && snapshot.unknownCount === 0) {
    return "high";
  }

  if (snapshot.occupiedEstimate === 0 && snapshot.unknownCount <= 3) {
    return "medium";
  }

  if (snapshot.occupiedEstimate <= 5) {
    return "low-but-interesting";
  }

  return "not-empty";
}

export function buildSeatSnapshot(
  showtimeId: string,
  rawSeats: RawSeat[],
  checkedAt = new Date(),
): SeatSnapshot {
  const counts: Record<SeatStatus, number> = {
    available: 0,
    sold: 0,
    reserved: 0,
    blocked: 0,
    wheelchair: 0,
    companion: 0,
    unknown: 0,
  };

  for (const seat of rawSeats) {
    counts[classifySeatStatus(seat)] += 1;
  }

  const sellableSeats = counts.available + counts.sold + counts.reserved;
  const occupiedEstimate = counts.sold + counts.reserved;
  return {
    showtimeId,
    checkedAt: checkedAt.toISOString(),
    totalSeats: rawSeats.length,
    sellableSeats,
    availableCount: counts.available,
    occupiedEstimate,
    blockedCount: counts.blocked,
    accessibilityCount: counts.wheelchair + counts.companion,
    unknownCount: counts.unknown,
    confidence: scoreShowing({
      occupiedEstimate,
      unknownCount: counts.unknown,
    }),
    rawSnapshot: {
      counts,
      seats: rawSeats,
    },
  };
}
