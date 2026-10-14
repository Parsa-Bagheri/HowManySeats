import type { SearchCandidate, SeatSnapshot } from "../types";

function boundedLimit(name: string, maximum: number) {
  const value = Number(process.env[name] ?? maximum);
  if (!Number.isInteger(value) || value < 1 || value > maximum) throw new Error(`Invalid ${name}`);
  return value;
}
export const WATCH_LIMITS = {
  active: boundedLimit("WATCH_MAX_ACTIVE", 50), registrationsPerHour: boundedLimit("WATCH_MAX_REGISTRATIONS", 20), durationMs: 48 * 60 * 60_000,
  intervalMs: 5 * 60_000, staleMs: 10 * 60_000, history: 24, jobs: 64,
  attempts: 3, leaseMs: 30_000, retentionMs: 7 * 24 * 60 * 60_000,
} as const;

export type Observation = SeatSnapshot & {
  unknownSeats: number; excludedSeats: number; partial: boolean;
};
export type Snapshot = { jobKey: string; scheduledAt: number; observedAt: number; storedAt: number; seats: Observation };
export type Failure = { jobKey: string; scheduledAt: number; at: number; code: string; message: string; terminal: boolean };
export type RefreshJob = {
  key: string; scheduledAt: number; status: "pending" | "running" | "complete" | "dead";
  attempts: number; nextAttemptAt: number; leaseToken?: string; leaseUntil?: number;
  publishedAt?: number; durationMs?: number;
};
export type Watch = {
  id: string; screening: SearchCandidate; createdAt: number; expiresAt: number;
  paused: boolean; nextRefreshAt: number; retiredBefore: number;
  jobs: Record<string, RefreshJob>; history: Snapshot[]; latest?: Snapshot;
  failures: Failure[]; lastFailure?: Failure; lastSuccessAt?: number;
  totals: { success: number; failure: number; duplicate: number; fenced: number };
};
export type Registry = { entries: Record<string, number>; window: number; attempts: number; paused?: boolean };
export type Message = { watchId: string; jobKey: string; scheduledAt: number };
export type Delivery = { id: string; receipt: string; message: Message; enqueuedAt: number };

// Mutators must be synchronous and free of external side effects: DynamoDB may retry a CAS.
export interface DocumentStore {
  get<T>(key: string): Promise<T | undefined>;
  mutate<T, R>(key: string, change: (current: T | undefined) => { value: T; result: R }, expiresAt?: number): Promise<R>;
  mutatePair<A, B, R>(keys: [string, string], change: (a: A | undefined, b: B | undefined) => { values: [A, B]; result: R }, expiresAt?: [number | undefined, number | undefined]): Promise<R>;
}
export interface DurableQueue {
  send(message: Message, availableAt?: number): Promise<void>;
  acknowledge(delivery: Delivery): Promise<void>;
  retry(delivery: Delivery, availableAt: number): Promise<void>;
  deadLetter(delivery: Delivery, reason: string): Promise<void>;
}
export type Collector = (screening: SearchCandidate) => Promise<Observation>;

export function watchState(watch: Watch, now = Date.now()) {
  if (now >= watch.expiresAt) return "ended";
  if (watch.paused) return "paused";
  if (!watch.latest) return watch.lastFailure ? "unavailable" : "pending";
  if ((watch.lastFailure && (watch.lastFailure.scheduledAt > watch.latest.scheduledAt || (watch.lastFailure.scheduledAt === watch.latest.scheduledAt && watch.lastFailure.at > watch.latest.storedAt))) || now - watch.latest.observedAt > WATCH_LIMITS.staleMs) return "stale";
  return watch.latest.seats.partial ? "partial" : "fresh";
}

export class WatchError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}
export class CollectionError extends Error {
  constructor(public readonly code: string, message: string, public readonly retryable: boolean) { super(message); }
}
