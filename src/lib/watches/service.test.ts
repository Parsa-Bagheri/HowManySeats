import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { LocalStore } from "./local";
import { WatchService } from "./service";
import { fixtureScreening } from "./fixtures";
import { buildSeatSnapshot } from "../seat-scoring";
import { CollectionError, WATCH_LIMITS, WatchError, watchState, type Collector, type Delivery, type DurableQueue, type Message, type Observation, type Registry } from "./model";

class TestQueue implements DurableQueue {
  deliveries: Delivery[] = []; acked: string[] = []; retries: number[] = []; dead: string[] = [];
  async send(message: Message) { this.deliveries.push({ id: String(this.deliveries.length), receipt: "test", message, enqueuedAt: Date.now() }); }
  async acknowledge(delivery: Delivery) { this.acked.push(delivery.id); }
  async retry(_delivery: Delivery, at: number) { this.retries.push(at); }
  async deadLetter(_delivery: Delivery, reason: string) { this.dead.push(reason); }
}
async function harness(t: test.TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "watch-unit-")); const store = new LocalStore(join(directory, "db.sqlite"));
  const clock = { now: Date.now() }; const queue = new TestQueue(); const service = new WatchService(store, queue, () => clock.now);
  const screening = fixtureScreening("900001", clock.now);
  t.after(async () => { store.close(); assert(resolve(directory).startsWith(resolve(tmpdir()) + sep)); await rm(directory, { recursive: true, force: true }); });
  const observation = (): Observation => ({ ...buildSeatSnapshot([{ type: "Standard", status: "Available" }, { type: "Wheelchair", status: "Reserved" }, { type: "Companion", status: "Available" }, { status: "Unknown" }, { status: "Broken" }], new Date(clock.now)), unknownSeats: 1, excludedSeats: 1, partial: true });
  return { store, queue, clock, service, screening, observation };
}

test("durable registration uses canonical expiry and joining cannot renew metadata", async (t) => {
  const h = await harness(t); h.screening.showtime.startsAt = new Date(h.clock.now + 60_000).toISOString();
  await h.service.register(h.screening.showtime.id, async () => h.screening);
  const registry = (await h.store.get<Registry>("registry"))!;
  assert.equal(registry.entries[h.screening.showtime.id], h.clock.now + 60_000);
  const again = await h.service.register(h.screening.showtime.id, async () => { throw new Error("Must not rediscover/renew"); });
  assert.equal(again.expiresAt, h.clock.now + 60_000);
  h.clock.now += 61_000;
  const other = fixtureScreening("900002", h.clock.now); await h.service.register(other.showtime.id, async () => other);
  assert.equal((await h.store.get<Registry>("registry"))!.entries[h.screening.showtime.id], undefined);
});

test("global registration attempts include invalid IDs, and expired discovery reservations recover", async (t) => {
  const h = await harness(t);
  for (let index = 0; index < WATCH_LIMITS.registrationsPerHour; index++) await assert.rejects(h.service.register(`cineplex-7402-${index}`, async () => { throw new WatchError(404, "Not found"); }), /Not found/);
  await assert.rejects(h.service.register(h.screening.showtime.id, async () => h.screening), (error: unknown) => error instanceof WatchError && error.status === 429);
  h.clock.now += 3_600_000;
  await h.store.mutate<Registry, void>("registry", () => ({ value: { entries: { abandoned: h.clock.now + 90_000 }, attempts: 0, window: Math.floor(h.clock.now / 3_600_000) }, result: undefined }));
  h.clock.now += 91_000;
  const other = fixtureScreening("900002", h.clock.now); await h.service.register(other.showtime.id, async () => other);
  assert.equal((await h.store.get<Registry>("registry"))!.entries.abandoned, undefined);
});

test("duplicates and store-before-ack replay produce one history entry and preserve all categories", async (t) => {
  const h = await harness(t); await h.service.register(h.screening.showtime.id, async () => h.screening);
  const delivery = h.queue.deliveries[0];
  await assert.rejects(h.service.process(delivery, async () => h.observation(), { afterStore: async () => { throw new Error("Simulated crash"); } }), /Simulated crash/);
  assert.equal(h.queue.acked.length, 0);
  assert.equal(await h.service.process(delivery, async () => { throw new Error("Must not collect again"); }), "duplicate-or-inactive");
  const watch = (await h.service.get(h.screening.showtime.id))!;
  assert.equal(watch.history.length, 1); assert.equal(watch.totals.success, 1); assert.equal(watch.latest?.seats.accessibleSeats, 1); assert.equal(watch.latest?.seats.companionSeats, 1); assert.equal(watch.latest?.seats.unknownSeats, 1); assert.equal(watch.latest?.seats.excludedSeats, 1); assert.equal(watchState(watch, h.clock.now), "partial");
});

test("delayed older completion cannot regress latest even with a newer observation time", async (t) => {
  const h = await harness(t); await h.service.register(h.screening.showtime.id, async () => h.screening);
  let release!: (value: Observation) => void;
  const older = h.service.process(h.queue.deliveries[0], () => new Promise((done) => { release = done; }), { leaseMs: 900_000 });
  await new Promise((done) => setTimeout(done, 5)); h.clock.now += WATCH_LIMITS.intervalMs; await h.service.dispatch();
  await h.service.process(h.queue.deliveries[1], async () => h.observation());
  const latest = (await h.service.get(h.screening.showtime.id))!.latest!;
  h.clock.now += 1000; release(h.observation()); assert.equal(await older, "stored");
  const watch = (await h.service.get(h.screening.showtime.id))!;
  assert.equal(watch.latest?.jobKey, latest.jobKey); assert.equal(watch.latest?.observedAt, latest.observedAt); assert.equal(watch.history.length, 2);
});

test("expired ownership fences both a late success and a late failure", async (t) => {
  for (const succeeds of [true, false]) {
    const h = await harness(t); await h.service.register(h.screening.showtime.id, async () => h.screening);
    let release!: () => void; const barrier = new Promise<void>((done) => { release = done; });
    const old = h.service.process(h.queue.deliveries[0], async () => { await barrier; if (!succeeds) throw new CollectionError("timeout", "Late timeout", true); return h.observation(); });
    await new Promise((done) => setTimeout(done, 5)); h.clock.now += WATCH_LIMITS.leaseMs + 1; release();
    assert.equal(await old, "fenced"); const watch = (await h.service.get(h.screening.showtime.id))!;
    assert.equal(watch.history.length, 0); assert.equal(watch.failures.length, 0); assert.equal(watch.totals.fenced, 1);
    assert.equal(await h.service.process(h.queue.deliveries[0], async () => h.observation()), "stored"); assert.equal((await h.service.get(h.screening.showtime.id))!.history.length, 1);
  }
});

test("temporary timeout/rate-limit failures back off and terminate with inspectable unavailable state", async (t) => {
  const h = await harness(t); await h.service.register(h.screening.showtime.id, async () => h.screening);
  const collect: Collector = async () => { throw new CollectionError("rate-limited", "Cineplex limited this refresh.", true); };
  assert.equal(await h.service.process(h.queue.deliveries[0], collect), "retry"); assert.equal(h.queue.retries[0], h.clock.now + 60_000);
  assert.equal(watchState((await h.service.get(h.screening.showtime.id))!, h.clock.now), "unavailable");
  h.clock.now = h.queue.retries[0]; assert.equal(await h.service.process(h.queue.deliveries[0], collect), "retry"); assert.equal(h.queue.retries[1], h.clock.now + 120_000);
  h.clock.now = h.queue.retries[1]; assert.equal(await h.service.process(h.queue.deliveries[0], collect), "dead");
  const watch = (await h.service.get(h.screening.showtime.id))!; assert.equal(watch.failures.length, 3); assert.equal(watch.lastFailure?.terminal, true); assert.equal(watch.latest, undefined); assert.equal(h.queue.dead.length, 1);
});

test("a successful retry clears freshness failure while retaining failure history", async (t) => {
  const h = await harness(t); await h.service.register(h.screening.showtime.id, async () => h.screening);
  await h.service.process(h.queue.deliveries[0], async () => { throw new CollectionError("timeout", "Deadline elapsed", true); });
  h.clock.now = h.queue.retries[0]; await h.service.process(h.queue.deliveries[0], async () => ({ ...h.observation(), partial: false, unknownSeats: 0 }));
  const watch = (await h.service.get(h.screening.showtime.id))!; assert.equal(watch.failures.length, 1); assert.equal(watchState(watch, h.clock.now), "fresh");
  h.clock.now += WATCH_LIMITS.staleMs + 1; assert.equal(watchState(watch, h.clock.now), "stale");
});

test("terminal malformed payload is never represented as zero seats", async (t) => {
  const h = await harness(t); await h.service.register(h.screening.showtime.id, async () => h.screening);
  assert.equal(await h.service.process(h.queue.deliveries[0], async () => { throw new CollectionError("malformed", "Invalid map", false); }), "dead");
  const watch = (await h.service.get(h.screening.showtime.id))!; assert.equal(watch.latest, undefined); assert.equal(watchState(watch, h.clock.now), "unavailable"); assert.equal(h.queue.retries.length, 0);
});

test("paused/ended watches stop collection and history/jobs stay bounded during replay/outage", async (t) => {
  const h = await harness(t); await h.service.register(h.screening.showtime.id, async () => h.screening);
  await h.service.pause(h.screening.showtime.id, true); assert.equal(await h.service.process(h.queue.deliveries[0], async () => { throw new Error("Paused"); }), "duplicate-or-inactive");
  assert.equal(watchState((await h.service.get(h.screening.showtime.id))!, h.clock.now), "paused"); await h.service.pause(h.screening.showtime.id, false);
  for (let index = 0; index < 80; index++) {
    await h.service.dispatch(); const watch = (await h.service.get(h.screening.showtime.id))!;
    const job = Object.values(watch.jobs).find((item) => item.status === "pending"); assert(job);
    await h.service.process({ id: String(index), receipt: "test", message: { watchId: watch.id, jobKey: job.key, scheduledAt: job.scheduledAt }, enqueuedAt: h.clock.now }, async () => h.observation()); h.clock.now += WATCH_LIMITS.intervalMs;
  }
  let watch = (await h.service.get(h.screening.showtime.id))!; assert.equal(watch.history.length, WATCH_LIMITS.history); assert(Object.keys(watch.jobs).length <= WATCH_LIMITS.jobs);
  for (let index = 0; index < 80; index++) { h.clock.now += WATCH_LIMITS.intervalMs; await h.service.dispatch(); }
  watch = (await h.service.get(h.screening.showtime.id))!; assert(Object.keys(watch.jobs).length <= WATCH_LIMITS.jobs);
  h.clock.now = watch.expiresAt; await h.service.dispatch(); assert.equal(watchState(watch, h.clock.now), "ended");
});

test("SQLite queue receipts fence old acknowledgements after abandoned-work recovery", async (t) => {
  const h = await harness(t); const now = Date.now();
  await h.store.send({ watchId: "cineplex-7402-900001", jobKey: "key", scheduledAt: now });
  const old = (await h.store.claim(100, now + 5))!; assert(old);
  const newer = (await h.store.claim(1000, now + 106))!; assert(newer); assert.notEqual(old.receipt, newer.receipt);
  await h.store.acknowledge(old); assert.equal(h.store.inspect().length, 1);
  await h.store.acknowledge(newer); assert.equal(h.store.inspect().length, 0);
});
