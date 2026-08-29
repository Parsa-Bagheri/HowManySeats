import type { ShowtimeExperienceType } from "./experience-types";

export type SeatStatus =
  | "available"
  | "sold"
  | "reserved"
  | "blocked"
  | "wheelchair"
  | "companion"
  | "unknown";

export type Confidence = "high" | "medium" | "low-but-interesting" | "not-empty" | "unknown";
export type SortOption = "distance-asc" | "distance-desc" | "time-asc" | "time-desc";

export type Theatre = {
  id: string;
  cineplexId?: string;
  name: string;
  address?: string;
  city: string;
  province: string;
  postalCode?: string;
  latitude?: number;
  longitude?: number;
  amenities: string[];
  isVip?: boolean;
};

export type Showtime = {
  id: string;
  cineplexShowtimeId?: string;
  theatreId: string;
  movieTitle: string;
  startsAt: string;
  format?: string;
  auditorium?: string;
  ticketUrl: string;
  accessibleServices?: string[];
};

export type SeatSnapshot = {
  showtimeId: string;
  checkedAt: string;
  totalSeats: number;
  sellableSeats: number;
  availableCount: number;
  occupiedEstimate: number;
  blockedCount: number;
  accessibilityCount: number;
  unknownCount: number;
  confidence: Confidence;
  rawSnapshot: unknown;
};

export type SearchResult = {
  theatre: Theatre;
  showtime: Showtime;
  snapshot: SeatSnapshot;
  distanceKm?: number;
};

export type MovieSuggestion = {
  title: string;
  theatreCount: number;
  showtimeCount: number;
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
  id?: string;
  label?: string;
  status?: string;
  type?: string;
  ariaLabel?: string;
  className?: string;
  disabled?: boolean;
  selectable?: boolean;
};
