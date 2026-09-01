export type UiMode = "clean" | "fun";

export const UI_MODE_COOKIE_NAME = "how-many-seats-ui-mode";

export function parseUiMode(value: unknown): UiMode | undefined {
  return value === "clean" || value === "fun" ? value : undefined;
}
