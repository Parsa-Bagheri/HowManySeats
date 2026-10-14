import { randomUUID } from "node:crypto";
import type { SearchCandidate } from "../types";
import { CollectionError, WatchError, WATCH_LIMITS, type Collector, type Delivery, type DocumentStore, type DurableQueue, type Failure, type Message, type Registry, type Watch } from "./model";

const watchKey = (id: string) => `watch:${id}`;
const emptyRegistry = (): Registry => ({ entries: {}, window: 0, attempts: 0 });
export class WatchService {
  constructor(public readonly store: DocumentStore, public readonly queue: DurableQueue, private readonly now = Date.now, private readonly operatingEndAt?: number) {}

  async operating() { return (!this.operatingEndAt || this.now() < this.operatingEndAt) && !(await this.store.get<Registry>("registry"))?.paused; }
  async pauseAll(paused: boolean) {
    await this.store.mutate<Registry, void>("registry", (value = emptyRegistry()) => { value.paused = paused; return { value, result: undefined }; });
    // Pausing each watch fences collectors already in flight before this operation returns.
    if (paused) for (const watch of await this.list()) await this.pause(watch.id, true);
  }

  async get(id: string) { return this.store.get<Watch>(watchKey(id)); }
  async list() {
    const registry = await this.store.get<Registry>("registry");
    const rows = await Promise.all(Object.keys(registry?.entries ?? {}).map((id) => this.get(id)));
    return rows.filter((row): row is Watch => Boolean(row));
  }

  async register(id: string, resolve: () => Promise<SearchCandidate>) {
    if (!await this.operating()) throw new WatchError(503, "Background collection is paused or its operating window has ended.");
    const existing = await this.get(id);
    // Joining an existing watch cannot extend its lifetime or change its canonical metadata.
    if (existing && existing.expiresAt > this.now()) return existing;
    const now = this.now();
    await this.store.mutate<Registry, void>("registry", (value = emptyRegistry()) => {
      if (value.paused) throw new WatchError(503, "Background collection is paused.");
      value.entries = Object.fromEntries(Object.entries(value.entries).filter(([, expiry]) => expiry > now));
      const window = Math.floor(now / 3_600_000);
      if (value.window !== window) { value.window = window; value.attempts = 0; }
      if (value.attempts >= WATCH_LIMITS.registrationsPerHour || Object.keys(value.entries).length >= WATCH_LIMITS.active) throw new WatchError(429, "The watch service has reached its limit. Try again later.");
      if (value.entries[id]) throw new WatchError(409, "This screening is being registered. Try again shortly.");
      value.attempts++;
      // Reserve before discovery, including invalid attempts, so forged browser IDs cannot bypass limits.
      value.entries[id] = now + 90_000;
      return { value, result: undefined };
    });
    let screening: SearchCandidate;
    try {
      screening = await resolve();
      const startsAt = Date.parse(screening.showtime.startsAt);
      if (screening.theatre.provider !== "cineplex" || screening.showtime.id !== id || !Number.isFinite(startsAt) || startsAt <= now || startsAt > now + WATCH_LIMITS.durationMs) throw new WatchError(400, "Watch a Cineplex screening starting in the next 48 hours.");
    }
    catch (error) {
      await this.store.mutate<Registry, void>("registry", (value = emptyRegistry()) => { delete value.entries[id]; return { value, result: undefined }; });
      throw error;
    }
    const startsAt = Date.parse(screening.showtime.startsAt);
    const expiresAt = Math.min(startsAt, now + WATCH_LIMITS.durationMs);
    const watch = await this.store.mutatePair<Watch, Registry, Watch>([watchKey(id), "registry"], (current, registry = emptyRegistry()) => {
      if (registry.paused || (this.operatingEndAt && this.now() >= this.operatingEndAt)) throw new WatchError(503, "Background collection is paused or its operating window has ended.");
      if ((registry.entries[id] ?? 0) <= this.now()) throw new WatchError(409, "Registration expired. Try again.");
      const value: Watch = current && current.expiresAt > now ? current : {
        id, screening: { theatre: screening.theatre, showtime: screening.showtime }, createdAt: now, expiresAt,
        paused: false, nextRefreshAt: now, retiredBefore: 0, jobs: {}, history: [], failures: [],
        totals: { success: 0, failure: 0, duplicate: 0, fenced: 0 },
      };
      registry.entries[id] = value.expiresAt;
      return { values: [value, registry], result: value };
    }, [expiresAt + WATCH_LIMITS.retentionMs, undefined]);
    await this.dispatchWatch(id);
    return watch;
  }

  // Pause is an operator action (CLI / IAM protected cloud endpoint), never a public browser mutation.
  async pause(id: string, paused: boolean) {
    return this.store.mutate<Watch, Watch>(watchKey(id), (value) => {
      if (!value) throw new WatchError(404, "Watch not found.");
      value.paused = paused; return { value, result: value };
    });
  }
  async dispatch() {
    if (!await this.operating()) return;
    for (const watch of await this.list()) {
      if (!watch.paused && watch.expiresAt > this.now()) await this.dispatchWatch(watch.id);
    }
  }
  async dispatchWatch(id: string) {
    if (!await this.operating()) return;
    const now = this.now();
    const messages = await this.store.mutate<Watch, Message[]>(watchKey(id), (watch) => {
      if (!watch) throw new WatchError(404, "Watch not found.");
      if (watch.paused || watch.expiresAt <= now || (this.operatingEndAt !== undefined && this.now() >= this.operatingEndAt)) return { value: watch, result: [] };
      const sorted = Object.values(watch.jobs).sort((a, b) => a.scheduledAt - b.scheduledAt);
      for (const job of sorted.slice(0, Math.max(0, sorted.length - WATCH_LIMITS.jobs + 1))) {
        // Retire a contiguous prefix only, so delayed pending jobs are never accidentally retired.
        if (job.status !== "complete" && job.status !== "dead") break;
        watch.retiredBefore = Math.max(watch.retiredBefore, job.scheduledAt); delete watch.jobs[job.key];
      }
      if (watch.nextRefreshAt <= now && Object.keys(watch.jobs).length < WATCH_LIMITS.jobs) {
        const scheduledAt = Math.floor(now / WATCH_LIMITS.intervalMs) * WATCH_LIMITS.intervalMs;
        const key = `${id}:${scheduledAt}`;
        watch.jobs[key] ??= { key, scheduledAt, status: "pending", attempts: 0, nextAttemptAt: now };
        watch.nextRefreshAt = scheduledAt + WATCH_LIMITS.intervalMs;
      }
      const result = Object.values(watch.jobs).filter((job) =>
        (job.status === "pending" || (job.status === "running" && (job.leaseUntil ?? 0) <= now)) && job.nextAttemptAt <= now && (!job.publishedAt || now - job.publishedAt >= 60_000),
      ).map((job) => ({ watchId: id, jobKey: job.key, scheduledAt: job.scheduledAt }));
      return { value: watch, result };
    });
    for (const message of messages) {
      // Publish before marking: a crash can duplicate delivery, but cannot lose a job.
      await this.queue.send(message);
      await this.store.mutate<Watch, void>(watchKey(id), (value) => {
        if (!value) throw new Error("Watch disappeared");
        if (value.jobs[message.jobKey]) value.jobs[message.jobKey].publishedAt = now;
        return { value, result: undefined };
      });
    }
  }

  async process(delivery: Delivery, collector: Collector, hooks: { afterStore?: () => Promise<void>; leaseMs?: number } = {}) {
    if (!await this.operating()) { await this.queue.acknowledge(delivery); return "duplicate-or-inactive"; }
    const started = this.now();
    const token = randomUUID();
    const leaseMs = hooks.leaseMs ?? WATCH_LIMITS.leaseMs;
    const { message } = delivery;
    const claim = await this.store.mutate<Watch, { kind: "ack" | "busy" | "dead" | "collect"; screening?: SearchCandidate; retryAt?: number }>(watchKey(message.watchId), (watch) => {
      if (!watch) throw new WatchError(404, "Watch not found.");
      const job = watch.jobs[message.jobKey];
      if (!job || job.scheduledAt !== message.scheduledAt || job.key !== `${watch.id}:${job.scheduledAt}` || job.scheduledAt <= watch.retiredBefore || watch.paused || watch.expiresAt <= started) return { value: watch, result: { kind: "ack" } };
      if (job.status === "complete") { watch.totals.duplicate++; return { value: watch, result: { kind: "ack" } }; }
      if (job.status === "dead") return { value: watch, result: { kind: "dead" } };
      if (job.nextAttemptAt > started || (job.status === "running" && (job.leaseUntil ?? 0) > started)) return { value: watch, result: { kind: "busy", retryAt: Math.max(job.nextAttemptAt, job.leaseUntil ?? 0) } };
      if (job.attempts >= WATCH_LIMITS.attempts) {
        const failure: Failure = { jobKey: job.key, scheduledAt: job.scheduledAt, at: started, code: "abandoned", message: "Refresh stopped after repeated worker interruptions.", terminal: true };
        job.status = "dead"; recordFailure(watch, failure);
        return { value: watch, result: { kind: "dead" } };
      }
      job.status = "running"; job.attempts++; job.leaseToken = token; job.leaseUntil = started + leaseMs;
      return { value: watch, result: { kind: "collect", screening: watch.screening } };
    });
    if (claim.kind === "ack") { await this.queue.acknowledge(delivery); return "duplicate-or-inactive"; }
    if (claim.kind === "dead") { await this.queue.deadLetter(delivery, "terminal-refresh-failure"); return "dead"; }
    if (claim.kind === "busy") { await this.queue.retry(delivery, claim.retryAt ?? started + leaseMs); return "busy"; }
    let observation;
    try { observation = await collector(claim.screening!); }
    catch (error) {
      const now = this.now();
      const failure = error instanceof CollectionError ? error : new CollectionError("provider-unavailable", "Cineplex is temporarily unavailable.", true);
      const outcome = await this.store.mutate<Watch, { fenced: boolean; dead: boolean; retryAt: number }>(watchKey(message.watchId), (watch) => {
        if (!watch) throw new Error("Watch disappeared");
        const job = watch.jobs[message.jobKey];
        if (!ownsLease(job, token, this.now()) || watch.expiresAt <= this.now() || watch.paused || (this.operatingEndAt !== undefined && this.now() >= this.operatingEndAt)) { watch.totals.fenced++; return { value: watch, result: { fenced: true, dead: false, retryAt: now } }; }
        const dead = !failure.retryable || job.attempts >= WATCH_LIMITS.attempts;
        const retryAt = now + Math.min(60_000 * 2 ** (job.attempts - 1), WATCH_LIMITS.intervalMs);
        job.status = dead ? "dead" : "pending"; job.nextAttemptAt = retryAt; job.leaseToken = undefined; job.leaseUntil = undefined;
        job.durationMs = now - started;
        recordFailure(watch, { jobKey: job.key, scheduledAt: job.scheduledAt, at: now, code: failure.code, message: failure.message, terminal: dead });
        return { value: watch, result: { fenced: false, dead, retryAt } };
      });
      if (outcome.fenced) return "fenced";
      if (outcome.dead) await this.queue.deadLetter(delivery, failure.code);
      else await this.queue.retry(delivery, outcome.retryAt);
      return outcome.dead ? "dead" : "retry";
    }
    const now = this.now();
    const committed = await this.store.mutate<Watch, boolean>(watchKey(message.watchId), (watch) => {
      if (!watch) throw new Error("Watch disappeared");
      const job = watch.jobs[message.jobKey];
      if (!ownsLease(job, token, this.now()) || watch.expiresAt <= this.now() || watch.paused || (this.operatingEndAt !== undefined && this.now() >= this.operatingEndAt)) { watch.totals.fenced++; return { value: watch, result: false }; }
      const observedAt = Date.parse(observation.checkedAt);
      if (!Number.isFinite(observedAt) || observedAt > now + 5_000) throw new Error("Collector returned invalid observation time");
      const snapshot = { jobKey: job.key, scheduledAt: job.scheduledAt, observedAt, storedAt: now, seats: observation };
      if (!watch.history.some((item) => item.jobKey === job.key)) watch.history.push(snapshot);
      watch.history.sort((a, b) => b.scheduledAt - a.scheduledAt); watch.history = watch.history.slice(0, WATCH_LIMITS.history);
      // BOTH refresh order and observation time are monotonic. Delayed old jobs stay history only.
      if (!watch.latest || (snapshot.scheduledAt > watch.latest.scheduledAt && snapshot.observedAt >= watch.latest.observedAt)) watch.latest = snapshot;
      watch.lastSuccessAt = Math.max(watch.lastSuccessAt ?? 0, now); watch.totals.success++;
      job.status = "complete"; job.durationMs = now - started; job.leaseToken = undefined; job.leaseUntil = undefined;
      return { value: watch, result: true };
    });
    if (!committed) return "fenced";
    // Deliberately outside the durable commit: replay observes complete and acknowledges safely.
    await hooks.afterStore?.();
    await this.queue.acknowledge(delivery);
    return "stored";
  }
}

function ownsLease(job: Watch["jobs"][string] | undefined, token: string, now: number): job is Watch["jobs"][string] {
  return Boolean(job && job.status === "running" && job.leaseToken === token && (job.leaseUntil ?? 0) > now);
}
function recordFailure(watch: Watch, failure: Failure) {
  watch.failures.unshift(failure); watch.failures = watch.failures.slice(0, WATCH_LIMITS.history); watch.totals.failure++;
  if (!watch.lastFailure || failure.scheduledAt >= watch.lastFailure.scheduledAt) watch.lastFailure = failure;
}
