export type UiMode = "clean" | "fun";

export const UI_MODE_COOKIE_NAME = "empty-theatres-ui-mode";
export const UI_MODE_STORAGE_KEY = "empty-theatres-ui-mode";

export function parseUiMode(value: unknown): UiMode | undefined {
  return value === "clean" || value === "fun" ? value : undefined;
}
