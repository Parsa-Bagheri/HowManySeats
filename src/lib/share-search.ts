import { searchAreaSchema, validateSearchArea } from "./search-request";
import { buildSearchParams, type SearchState } from "./search-state";

/** Build from submitted result state, never the address bar or draft form. */
export function buildShareSearchUrl(
  origin: string,
  state: SearchState | undefined,
): string | undefined {
  if (!state) return undefined;
  const area = searchAreaSchema.safeParse(state);
  if (!area.success || !validateSearchArea(area.data).isValid) return undefined;

  const url = new URL("/", origin);
  url.search = buildSearchParams(state).toString();
  return url.toString();
}

export type ShareSearchResult = "shared" | "copied" | "cancelled" | "manual";

type ShareCapabilities = {
  share?: (data: { title: string; url: string }) => Promise<void>;
  copy?: (url: string) => Promise<void>;
};

/** A cancelled or failed native share never writes to the clipboard. */
export async function shareSearch(
  url: string,
  capabilities: ShareCapabilities,
): Promise<ShareSearchResult> {
  if (capabilities.share) {
    try {
      await capabilities.share({ title: "HowManySeats search", url });
      return "shared";
    } catch (error) {
      return isShareCancellation(error) ? "cancelled" : "manual";
    }
  }

  return copySearchLink(url, capabilities.copy);
}

export async function copySearchLink(
  url: string,
  copy?: (url: string) => Promise<void>,
): Promise<ShareSearchResult> {
  if (copy) {
    try {
      await copy(url);
      return "copied";
    } catch {
      // Keep the link available when clipboard permissions are denied.
    }
  }
  return "manual";
}

function isShareCancellation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    error.name === "AbortError"
  );
}
