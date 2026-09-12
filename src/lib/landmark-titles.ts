/**
 * The subset of Landmark's experience payload needed to normalize a movie
 * title. The property names mirror the public movie API response.
 */
export type LandmarkTitleExperience =
  | string
  | {
      Description?: string;
      Name?: string;
    };

type CatalogArticle = "A" | "An" | "The";

type ParsedArticle = {
  article: CatalogArticle;
  title: string;
};

type TrailingSuffix = {
  baseTitle: string;
  separator: string;
  suffix: string;
};

const CATALOG_ARTICLE_PATTERN = /^(.*),\s*(A|An|The)$/i;
const TRAILING_SUFFIX_SEPARATOR_PATTERN = /\s+[-–—]\s+/g;

/**
 * Converts a Landmark catalog title into its audience-facing form.
 *
 * A format-looking suffix is removed only when its normalized identity is an
 * exact match for a format in the current session's experience metadata. This
 * keeps an uncorroborated suffix intact because it may be part of the real
 * title. The function is intentionally pure and should be called per session
 * when a movie payload can contain sessions with different experiences.
 */
export function normalizeLandmarkMovieTitle(
  rawTitle: string | null | undefined,
  experiences: readonly LandmarkTitleExperience[] = [],
): string {
  const title = rawTitle?.trim() ?? "";

  if (!title) {
    return "";
  }

  const trailingArticle = parseCatalogArticle(title);
  const titleWithoutTrailingArticle = trailingArticle?.title ?? title;
  const suffix = parseTrailingSuffix(titleWithoutTrailingArticle);

  if (!suffix) {
    return applyCatalogArticle(
      titleWithoutTrailingArticle,
      trailingArticle?.article,
    );
  }

  if (!isCorroboratedFormatSuffix(suffix.suffix, experiences)) {
    const embeddedArticle = parseCatalogArticle(suffix.baseTitle);
    const normalizedBaseTitle = applyCatalogArticle(
      embeddedArticle?.title ?? suffix.baseTitle,
      trailingArticle?.article ?? embeddedArticle?.article,
    );

    return `${normalizedBaseTitle}${suffix.separator}${suffix.suffix}`;
  }

  const embeddedArticle = parseCatalogArticle(suffix.baseTitle);

  return applyCatalogArticle(
    embeddedArticle?.title ?? suffix.baseTitle,
    trailingArticle?.article ?? embeddedArticle?.article,
  );
}

function parseCatalogArticle(title: string): ParsedArticle | undefined {
  const match = title.match(CATALOG_ARTICLE_PATTERN);
  const body = match?.[1]?.trim();
  const article = match?.[2];

  if (!body || !article) {
    return undefined;
  }

  return {
    article: capitalizeArticle(article),
    title: body,
  };
}

function capitalizeArticle(article: string): CatalogArticle {
  switch (article.toLowerCase()) {
    case "a":
      return "A";
    case "an":
      return "An";
    default:
      return "The";
  }
}

function applyCatalogArticle(
  title: string,
  article: CatalogArticle | undefined,
): string {
  const normalizedTitle = title.trim();

  if (!article || !normalizedTitle) {
    return normalizedTitle;
  }

  if (
    normalizedTitle.toLowerCase().startsWith(`${article.toLowerCase()} `)
  ) {
    return normalizedTitle;
  }

  return `${article} ${normalizedTitle}`;
}

function parseTrailingSuffix(title: string): TrailingSuffix | undefined {
  let lastSeparatorIndex = -1;
  let lastSeparatorLength = 0;

  for (const match of title.matchAll(TRAILING_SUFFIX_SEPARATOR_PATTERN)) {
    lastSeparatorIndex = match.index ?? -1;
    lastSeparatorLength = match[0].length;
  }

  if (lastSeparatorIndex < 0) {
    return undefined;
  }

  const baseTitle = title.slice(0, lastSeparatorIndex).trim();
  const suffix = title.slice(lastSeparatorIndex + lastSeparatorLength).trim();
  const separator = title.slice(
    lastSeparatorIndex,
    lastSeparatorIndex + lastSeparatorLength,
  );

  return baseTitle && suffix ? { baseTitle, separator, suffix } : undefined;
}

function isCorroboratedFormatSuffix(
  suffix: string,
  experiences: readonly LandmarkTitleExperience[],
): boolean {
  const suffixIdentity = normalizeFormatIdentity(suffix);

  if (!suffixIdentity) {
    return false;
  }

  return experiences.some((experience) =>
    getExperienceLabels(experience).some(
      (label) => normalizeFormatIdentity(label) === suffixIdentity,
    ),
  );
}

function getExperienceLabels(
  experience: LandmarkTitleExperience,
): string[] {
  if (typeof experience === "string") {
    return [experience];
  }

  return [experience.Name, experience.Description].filter(
    (label): label is string =>
      typeof label === "string" && label.trim().length > 0,
  );
}

function normalizeFormatIdentity(value: string): string | undefined {
  let normalized = value
    .replace(/[®™]/g, "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[‐‑‒–—−]/g, "-")
    .replace(/\s+/g, " ")
    .trim();

  const trailingArticle = parseCatalogArticle(normalized);

  if (trailingArticle) {
    normalized = trailingArticle.title;
  }

  normalized = normalized.replace(/^the\s+/, "");
  normalized = normalized.replace(
    /\s+(experience|experiences|seating|seats)$/,
    "",
  );
  normalized = normalized.replace(/^the\s+/, "");
  normalized = normalized
    .replace(/\bd\s*-\s*box\b/g, "d-box")
    .replace(/\bd\s+box\b/g, "d-box")
    .replace(/\bscreen\s*x\b/g, "screenx")
    .replace(/\bultra\s+avx\b/g, "ultraavx")
    .replace(/\b(\d+)\s+d\b/g, "$1d")
    .replace(/\b(\d+)\s+mm\b/g, "$1mm")
    .replace(/\s+/g, " ")
    .trim();

  if (/^(experience|experiences|seating|seats)$/.test(normalized)) {
    return undefined;
  }

  return normalized || undefined;
}
