import { buildSeatSnapshot } from "./seat-scoring";
import type { RawSeat, SeatSnapshot } from "./types";

const LANDMARK_BOOKING_API_ORIGIN =
  "https://bookingapi.landmarkcinemas.com";
const SOURCE_TIMEOUT_MS = 10_000;

type LandmarkSeatRecord = Record<string, unknown> & {
  AreaCategoryCode?: number | string;
  AreaId?: number | string;
  Column?: number | string;
  Description?: string;
  Id?: number | string;
  PhysicalName?: number | string;
  Position?: unknown;
  Row?: number | string;
  SeatId?: number | string;
  SeatName?: string;
  SeatsInGroup?: unknown;
  SeatStyle?: number | string;
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
  const accessibilityTypes = getAccessibilityTypes(records);
  const snapshot = buildSeatSnapshot(
    records.map((record) =>
      toRawSeat(record, accessibilityTypes.get(getRecordKey(record))),
    ),
    checkedAt,
  );

  return {
    checkedAt: checkedAt.toISOString(),
    rows: buildPreviewRows(records, accessibilityTypes),
    snapshot,
  };
}

function collectSeatRecords(value: unknown): LandmarkSeatRecord[] {
  const records = new Map<string, LandmarkSeatRecord>();

  function visit(
    current: unknown,
    context: Pick<
      LandmarkSeatRecord,
      "AreaCategoryCode" | "AreaId" | "PhysicalName"
    > = {},
  ): void {
    if (Array.isArray(current)) {
      for (const item of current) {
        visit(item, context);
      }

      return;
    }

    if (!current || typeof current !== "object") {
      return;
    }

    const object = current as LandmarkSeatRecord;
    const id =
      toText(object.SeatId) || toText(object.SeatName) || toText(object.Id);
    const position = getSeatPosition(object.Position);
    const nextContext = {
      AreaCategoryCode: object.AreaCategoryCode ?? context.AreaCategoryCode,
      AreaId: object.AreaId ?? context.AreaId,
      PhysicalName: object.PhysicalName ?? context.PhysicalName,
    };

    if (
      id &&
      (object.Status !== undefined ||
        position !== undefined ||
        (object.Row !== undefined &&
          object.Column !== undefined &&
          object.Type !== undefined))
    ) {
      const seat = {
        ...object,
        ...nextContext,
        AreaId: object.AreaId ?? position?.area ?? nextContext.AreaId,
        Column: object.Column ?? position?.column,
        Row: object.Row ?? position?.row,
        SeatId: object.SeatId ?? object.Id,
      };

      records.set(getSeatKey(seat, id), seat);
      return;
    }

    for (const child of Object.values(object)) {
      visit(child, nextContext);
    }
  }

  visit(value);
  return Array.from(records.values());
}

function toRawSeat(
  record: LandmarkSeatRecord,
  accessibilityType?: "wheelchair" | "companion",
): RawSeat {
  return {
    status: getSeatAvailability(record.Status),
    type: accessibilityType,
  };
}

function buildPreviewRows(
  records: LandmarkSeatRecord[],
  accessibilityTypes: Map<string, "wheelchair" | "companion">,
): LandmarkPreviewRow[] {
  const rows = new Map<string, LandmarkPreviewSeat[]>();

  records.forEach((record, index) => {
    const seatName = toText(record.SeatName);
    const rowLabel = getSeatRowLabel(record, seatName);
    const column = getSeatColumn(record, seatName, index);
    const seatNumber = toText(record.SeatId) || String(column);
    const label =
      seatName ||
      (rowLabel === "Seats" ? `Seat ${index + 1}` : `${rowLabel}-${seatNumber}`);
    const row = rows.get(rowLabel) ?? [];
    const accessibilityType = accessibilityTypes.get(getRecordKey(record));
    const availability = getSeatAvailability(record.Status);

    row.push({
      accessible: Boolean(accessibilityType),
      column,
      id: getRecordKey(record, label),
      label,
      status: availability === "available" ? "available" : "unavailable",
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

function getAccessibilityTypes(
  records: LandmarkSeatRecord[],
): Map<string, "wheelchair" | "companion"> {
  const types = new Map<string, "wheelchair" | "companion">();
  const wheelchairGroupPositions = new Set<string>();

  for (const record of records) {
    const type = getExplicitAccessibilityType(record);

    if (type) {
      types.set(getRecordKey(record), type);
    }

    if (type === "wheelchair") {
      for (const position of getGroupedSeatPositions(record.SeatsInGroup)) {
        wheelchairGroupPositions.add(position);
      }
    }
  }

  for (const record of records) {
    const key = getRecordKey(record);
    const position = getGroupPosition(record.AreaId, record.Row, record.Column);

    if (!types.has(key) && position && wheelchairGroupPositions.has(position)) {
      types.set(key, "companion");
    }
  }

  return types;
}

function getExplicitAccessibilityType(
  record: LandmarkSeatRecord,
): "wheelchair" | "companion" | undefined {
  const label = toText(record.SeatName).toLowerCase();
  const details = [
    record.Type,
    record.Style,
    record.SeatStyle,
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

function getGroupedSeatPositions(value: unknown): string[] {
  if (!value || typeof value !== "object") {
    return [];
  }

  return Object.values(value).flatMap((item) => {
    if (!item || typeof item !== "object") {
      return [];
    }

    const position = item as Record<string, unknown>;
    const nestedPosition = getSeatPosition(position.Position);
    const key = getGroupPosition(
      position.AreaNumber ?? position.AreaId ?? nestedPosition?.area,
      position.RowIndex ?? position.Row ?? nestedPosition?.row,
      position.ColumnIndex ?? position.Column ?? nestedPosition?.column,
    );

    return key ? [key] : [];
  });
}

function getSeatPosition(
  value: unknown,
):
  | {
      area: number | string | undefined;
      column: number | string | undefined;
      row: number | string | undefined;
    }
  | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const position = value as Record<string, unknown>;

  return {
    area: toSeatCoordinate(position.AreaNumber ?? position.AreaId),
    column: toSeatCoordinate(position.ColumnIndex ?? position.Column),
    row: toSeatCoordinate(position.RowIndex ?? position.Row),
  };
}

function toSeatCoordinate(value: unknown): number | string | undefined {
  return typeof value === "number" || typeof value === "string"
    ? value
    : undefined;
}

function getGroupPosition(
  area: unknown,
  row: unknown,
  column: unknown,
): string | undefined {
  const parts = [area, row, column]
    .map(toText)
    .map((value) => value.trim());

  return parts.every(Boolean) ? parts.join("|") : undefined;
}

function getSeatAvailability(
  status: unknown,
): "available" | "occupied" | "unavailable" {
  if (status === undefined) {
    return "available";
  }

  const normalized = toText(status).trim().toLowerCase();

  if (
    normalized === "0" ||
    normalized === "5" ||
    normalized === "available"
  ) {
    return "available";
  }

  if (
    normalized === "1" ||
    normalized === "occupied" ||
    normalized === "sold" ||
    normalized === "held" ||
    normalized === "reserved"
  ) {
    return "occupied";
  }

  return "unavailable";
}

function getSeatRowLabel(
  record: LandmarkSeatRecord,
  seatLabel: string,
): string {
  const physicalName = toText(record.PhysicalName).trim();

  if (physicalName) {
    return physicalName;
  }

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

function getSeatKey(record: LandmarkSeatRecord, id: string): string {
  const landmarkPosition = [
    record.AreaCategoryCode,
    record.AreaId,
    record.Row,
    record.Column,
  ]
    .map(toText)
    .map((value) => value.trim());

  if (landmarkPosition.every(Boolean)) {
    return landmarkPosition.join("|");
  }

  const fallbackPosition = [
    record.PhysicalName,
    record.Row,
    record.Column,
  ]
    .map(toText)
    .map((value) => value.trim());

  return fallbackPosition.every(Boolean) ? fallbackPosition.join("|") : id;
}

function getRecordKey(record: LandmarkSeatRecord, fallback = ""): string {
  return getSeatKey(
    record,
    toText(record.SeatId) || toText(record.SeatName) || fallback,
  );
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
