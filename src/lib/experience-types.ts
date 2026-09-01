export const SHOWTIME_EXPERIENCE_TYPES = [
  "Regular",
  "IMAX",
  "UltraAVX",
  "VIP",
  "D-BOX",
  "4DX",
  "ScreenX",
  "3D",
  "70mm",
  "Recliner",
  "Dolby Atmos",
  "Laser Projection",
] as const;

export type ShowtimeExperienceType = (typeof SHOWTIME_EXPERIENCE_TYPES)[number];

const EXPERIENCE_TYPE_LOOKUP = new Map(
  SHOWTIME_EXPERIENCE_TYPES.map((experienceType) => [
    experienceType.toLowerCase(),
    experienceType,
  ]),
);

export function parseShowtimeExperienceTypes(
  values: Iterable<string>,
): ShowtimeExperienceType[] {
  const parsed = new Set<ShowtimeExperienceType>();

  for (const rawValue of values) {
    for (const value of rawValue.split(",")) {
      const experienceType = EXPERIENCE_TYPE_LOOKUP.get(
        value.trim().toLowerCase(),
      );

      if (experienceType) {
        parsed.add(experienceType);
      }
    }
  }

  return SHOWTIME_EXPERIENCE_TYPES.filter((experienceType) =>
    parsed.has(experienceType),
  );
}

export function showtimeMatchesExperienceTypes(
  format: string,
  selectedTypes: readonly ShowtimeExperienceType[],
): boolean {
  if (!selectedTypes.length) {
    return true;
  }

  const formatTokens = new Set(
    format
      .split(",")
      .map((token) => normalizeExperienceToken(token))
      .filter(Boolean),
  );

  return selectedTypes.some((selectedType) => {
    if (selectedType === "VIP") {
      return Array.from(formatTokens).some(
        (token) => token === "vip" || token.startsWith("vip "),
      );
    }

    return formatTokens.has(normalizeExperienceToken(selectedType));
  });
}

function normalizeExperienceToken(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}
