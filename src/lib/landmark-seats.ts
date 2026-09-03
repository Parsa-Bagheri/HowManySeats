import { buildSeatSnapshot } from "./seat-scoring";
import type { RawSeat, SeatSnapshot } from "./types";

const LANDMARK_BOOKING_API_ORIGIN =
  "https://bookingapi.landmarkcinemas.com";
const SOURCE_TIMEOUT_MS = 10_000;

type LandmarkSeatRecord = Record<string, unknown> & {
  Column?: number | string;
  Description?: string;
  Row?: number | string;
  SeatId?: number | string;
  SeatName?: string;
  SeatType?: number | string;
  Status?: number | string;
  Style?: number | string;
  Type?: number | string;
};

export type LandmarkPreviewSeat = {
  accessible: boolean;
  column: number;
  id: string;
  label: string;
  status: "available" | "unavailable";
};

export type LandmarkPreviewRow = {
  label: string;
  seats: LandmarkPreviewSeat[];
};

export type LandmarkSeatPreview = {
  checkedAt: string;
  rows: LandmarkPreviewRow[];
  snapshot: SeatSnapshot;
};

export async function fetchLandmarkSeatPreview(
  cinemaId: string,
  sessionId: string,
): Promise<LandmarkSeatPreview> {
  if (!isNumericId(cinemaId) || !isNumericId(sessionId)) {
    throw new Error("The Landmark seat preview link is invalid.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SOURCE_TIMEOUT_MS);

  try {
    const seatMapUrl = new URL(
      `/api/Seating/GetSessionSeatData/${encodeURIComponent(cinemaId)}/${encodeURIComponent(sessionId)}`,
      LANDMARK_BOOKING_API_ORIGIN,
    );
    const response = await fetch(seatMapUrl, {
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(
        `Landmark seat preview failed with HTTP ${response.status}: ${body.slice(0, 160)}`,
      );
    }

    return buildLandmarkSeatPreview(await response.json());
  } finally {
    clearTimeout(timeout);
  }
}

function buildLandmarkSeatPreview(data: unknown): LandmarkSeatPreview {
  const records = collectSeatRecords(data);

  if (!records.length) {
    throw new Error("Landmark returned an empty seat preview.");
  }

  const checkedAt = new Date();
  const snapshot = buildSeatSnapshot(records.map(toRawSeat), checkedAt);

  return {
    checkedAt: checkedAt.toISOString(),
    rows: buildPreviewRows(records),
    snapshot,
  };
}

function collectSeatRecords(value: unknown): LandmarkSeatRecord[] {
  const records = new Map<string, LandmarkSeatRecord>();

  function visit(current: unknown): void {
    if (Array.isArray(current)) {
      for (const item of current) {
        visit(item);
      }

      return;
    }

    if (!current || typeof current !== "object") {
      return;
    }

    const object = current as LandmarkSeatRecord;
    const id = toText(object.SeatId) || toText(object.SeatName);

    if (
      id &&
      (object.Status !== undefined ||
        (object.Row !== undefined &&
          object.Column !== undefined &&
          object.Type !== undefined))
    ) {
      records.set(id, object);
      return;
    }

    for (const child of Object.values(object)) {
      visit(child);
    }
  }

  visit(value);
  return Array.from(records.values());
}

function toRawSeat(record: LandmarkSeatRecord): RawSeat {
  return {
    status: isSeatAvailable(record.Status) ? "available" : "occupied",
    type: getAccessibilityType(record),
  };
}

function buildPreviewRows(
  records: LandmarkSeatRecord[],
): LandmarkPreviewRow[] {
  const rows = new Map<string, LandmarkPreviewSeat[]>();

  records.forEach((record, index) => {
    const label = toText(record.SeatName) || `Seat ${index + 1}`;
    const rowLabel = getSeatRowLabel(record, label);
    const row = rows.get(rowLabel) ?? [];
    const accessibilityType = getAccessibilityType(record);

    row.push({
      accessible: Boolean(accessibilityType),
      column: getSeatColumn(record, label, index),
      id: toText(record.SeatId) || label,
      label,
      status: isSeatAvailable(record.Status) ? "available" : "unavailable",
    });
    rows.set(rowLabel, row);
  });

  return Array.from(rows, ([label, seats]) => ({
    label,
    seats: seats.sort(
      (a, b) => a.column - b.column || a.label.localeCompare(b.label),
    ),
  })).sort((a, b) =>
    a.label.localeCompare(b.label, undefined, { numeric: true }),
  );
}

function getAccessibilityType(
  record: LandmarkSeatRecord,
): "wheelchair" | "companion" | undefined {
  const label = toText(record.SeatName).toLowerCase();
  const details = [
    record.Type,
    record.Style,
    record.SeatType,
    record.Description,
  ]
    .map(toText)
    .join(" ")
    .toLowerCase();

  if (/\bwc\d*\b|wheelchair/.test(label) || /wheelchair/.test(details)) {
    return "wheelchair";
  }

  if (/companion/.test(label) || /companion/.test(details)) {
    return "companion";
  }

  if (Number(record.Type) === 2) {
    return "wheelchair";
  }

  if (Number(record.Style) === 4) {
    return "companion";
  }

  return undefined;
}

function isSeatAvailable(status: unknown): boolean {
  if (status === undefined) {
    return true;
  }

  const normalized = toText(status).trim().toLowerCase();
  return normalized === "0" || normalized === "available";
}

function getSeatRowLabel(
  record: LandmarkSeatRecord,
  seatLabel: string,
): string {
  const labelRow = seatLabel.includes("-")
    ? seatLabel.split("-", 1)[0]?.trim()
    : undefined;

  if (labelRow) {
    return labelRow;
  }

  const row = toText(record.Row).trim();

  if (row) {
    return row;
  }

  return "Seats";
}

function getSeatColumn(
  record: LandmarkSeatRecord,
  seatLabel: string,
  fallback: number,
): number {
  const explicitColumn = Number(record.Column);

  if (Number.isFinite(explicitColumn)) {
    return explicitColumn;
  }

  const labelColumn = Number(seatLabel.match(/(\d+)$/)?.[1]);
  return Number.isFinite(labelColumn) ? labelColumn : fallback;
}

function isNumericId(value: string): boolean {
  return /^\d+$/.test(value);
}

function toText(value: unknown): string {
  return typeof value === "string" || typeof value === "number"
    ? String(value)
    : "";
}
