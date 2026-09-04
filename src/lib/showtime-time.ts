export function localDateTimeToIso(
  date: string,
  time: string,
  timeZone: string,
): string | undefined {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const timeMatch = /^(\d{1,2}):(\d{2})\s*([AP]M)$/i.exec(time.trim());

  if (!dateMatch || !timeMatch) {
    return undefined;
  }

  let hour = Number(timeMatch[1]) % 12;

  if (timeMatch[3].toUpperCase() === "PM") {
    hour += 12;
  }

  return localPartsToIso(
    {
      day: Number(dateMatch[3]),
      hour,
      minute: Number(timeMatch[2]),
      month: Number(dateMatch[2]),
      second: 0,
      year: Number(dateMatch[1]),
    },
    timeZone,
  );
}

export function normalizeLocalIsoDateTime(
  value: string,
  timeZone: string | undefined,
): string | undefined {
  const trimmed = value.trim();
  const parsed = new Date(trimmed);

  if (/([zZ]|[+-]\d{2}:?\d{2})$/.test(trimmed)) {
    return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
  }

  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/.exec(
      trimmed,
    );

  if (!match || !timeZone) {
    return Number.isNaN(parsed.getTime()) ? undefined : trimmed;
  }

  return localPartsToIso(
    {
      day: Number(match[3]),
      hour: Number(match[4]),
      minute: Number(match[5]),
      month: Number(match[2]),
      second: Number(match[6] ?? 0),
      year: Number(match[1]),
    },
    timeZone,
  );
}

function localPartsToIso(
  parts: {
    day: number;
    hour: number;
    minute: number;
    month: number;
    second: number;
    year: number;
  },
  timeZone: string,
): string | undefined {
  const targetLocalAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  const formatter = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
    month: "2-digit",
    second: "2-digit",
    timeZone,
    year: "numeric",
  });
  let instant = targetLocalAsUtc;

  for (let iteration = 0; iteration < 3; iteration += 1) {
    const formattedParts = Object.fromEntries(
      formatter
        .formatToParts(new Date(instant))
        .filter((part) => part.type !== "literal")
        .map((part) => [part.type, Number(part.value)]),
    );
    const formattedLocalAsUtc = Date.UTC(
      formattedParts.year,
      formattedParts.month - 1,
      formattedParts.day,
      formattedParts.hour,
      formattedParts.minute,
      formattedParts.second,
    );
    const adjustment = targetLocalAsUtc - formattedLocalAsUtc;

    instant += adjustment;

    if (adjustment === 0) {
      break;
    }
  }

  const result = new Date(instant);
  return Number.isNaN(result.getTime()) ? undefined : result.toISOString();
}
