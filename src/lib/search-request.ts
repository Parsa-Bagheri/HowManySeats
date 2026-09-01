import { z } from "zod";
import { getSearchDates, isValidDateInput } from "./date-range";

export const searchAreaSchema = z.object({
  location: z.string().trim().min(1, "Enter an address, postal code, or city."),
  date: z
    .string()
    .refine(isValidDateInput, "Enter a valid start date in YYYY-MM-DD format."),
  endDate: z
    .string()
    .refine(isValidDateInput, "Enter a valid end date in YYYY-MM-DD format.")
    .optional(),
  radiusKm: z.coerce
    .number()
    .min(1, "Enter a radius of at least 1 km.")
    .max(250, "Enter a radius of no more than 250 km."),
  latitude: z.coerce.number().min(-90).max(90).optional(),
  longitude: z.coerce.number().min(-180).max(180).optional(),
});

type SearchAreaInput = z.infer<typeof searchAreaSchema>;

export function searchParamsToRecord(
  searchParams: URLSearchParams,
): Record<string, string> {
  const values = Object.fromEntries(searchParams.entries());
  const experienceTypes = searchParams.getAll("experienceTypes");

  if (experienceTypes.length) {
    values.experienceTypes = experienceTypes.join(",");
  }

  return values;
}

export function validateSearchArea(input: SearchAreaInput) {
  const dates = getSearchDates(input.date, input.endDate ?? input.date);
  const hasCompleteCoordinates =
    (input.latitude === undefined && input.longitude === undefined) ||
    (input.latitude !== undefined && input.longitude !== undefined);

  return {
    isValid: Boolean(dates) && hasCompleteCoordinates,
    issues: {
      dateRange: dates
        ? undefined
        : "Choose a date range of one to three days.",
      coordinates: hasCompleteCoordinates
        ? undefined
        : "Provide both latitude and longitude, or omit both.",
    },
  };
}
