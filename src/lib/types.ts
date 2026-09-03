import type { ShowtimeExperienceType } from "./experience-types";

export type SortOption =
  "distance-asc" | "distance-desc" | "time-asc" | "time-desc";

export type CinemaProvider = "cineplex" | "landmark";

export type Theatre = {
  id: string;
  provider: CinemaProvider;
  providerTheatreId: string;
  name: string;
  address?: string;
  city: string;
  province: string;
  postalCode?: string;
  latitude?: number;
  longitude?: number;
  timeZone?: string;
};

export type Showtime = {
  id: string;
  providerShowtimeId: string;
  theatreId: string;
  movieTitle: string;
  startsAt: string;
  format: string;
  auditorium?: string;
  purchaseUrl?: string;
  seatPreviewUrl: string;
};

export type SeatSnapshot = {
  checkedAt: string;
  sellableSeats: number;
  occupiedEstimate: number;
  accessibilityCount: number;
};

export type SearchCandidate = {
  theatre: Theatre;
  showtime: Showtime;
  snapshot?: SeatSnapshot;
  distanceKm?: number;
};

export type SearchResult = SearchCandidate & {
  snapshot: SeatSnapshot;
};

export type MovieSuggestion = {
  title: string;
  theatreCount: number;
  showtimeCount: number;
};

export type MovieSuggestionQuery = Pick<
  SearchQuery,
  "location" | "date" | "endDate" | "radiusKm" | "latitude" | "longitude"
> & {
  movieTitle: string;
  limit?: number;
};

export type SearchQuery = {
  location: string;
  date: string;
  endDate?: string;
  radiusKm: number;
  latitude?: number;
  longitude?: number;
  movieTitle?: string;
  experienceTypes?: ShowtimeExperienceType[];
  onlyZeroSold?: boolean;
  maxFiveSold?: boolean;
  startsInNextTwoHours?: boolean;
  nonVipOnly?: boolean;
  accessibleAvailable?: boolean;
  sortBy?: SortOption;
};

export type RawSeat = {
  status?: string;
  type?: string;
};
