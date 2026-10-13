import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve, sep } from "node:path";
import { LocalStore } from "../src/lib/watches/local";
import { WatchService } from "../src/lib/watches/service";
import { fixtureScreening } from "../src/lib/watches/fixtures";
import { WATCH_LIMITS, type Watch } from "../src/lib/watches/model";

const directory = await mkdtemp(join(tmpdir(), "howmanyseats-replay-"));
const logs: string[] = [];
const started = Date.now();
const children = new Set<ReturnType<typeof spawn>>();
function worker(db: string, extra: Record<string, string> = {}) {
  const child = spawn(process.execPath, ["--import", "tsx", "scripts/watch-service.ts", "worker", "--idle-exit-ms=1200"], {
    cwd: process.cwd(), env: { ...process.env, WATCH_DB_PATH: db, WATCH_MODE: "fixture", WATCH_TEST_LEASE_MS: "2000", ...extra }, stdio: ["ignore", "pipe", "pipe"],
  });
  children.add(child); let output = "";
  child.stdout.on("data", (chunk) => { output += String(chunk); });
  child.stderr.on("data", (chunk) => { logs.push(`pid=${child.pid} stderr ${String(chunk).trim()}`); });
  const done = new Promise<{ code: number | null; output: string }>((resolveDone, reject) => {
    const timeout = setTimeout(() => { child.kill(); reject(new Error(`Worker ${child.pid} timed out`)); }, 20_000);
    child.on("error", reject);
    child.on("exit", (code) => { clearTimeout(timeout); children.delete(child); logs.push(output.trim()); resolveDone({ code, output }); });
  });
  return { child, done };
}
async function waitUntil(check: () => Promise<boolean>, timeout = 5000) {
  const end = Date.now() + timeout;
  while (!await check()) { if (Date.now() > end) throw new Error("Condition timed out"); await new Promise((done) => setTimeout(done, 25)); }
}
try {
  const path = join(directory, "two-workers.sqlite"); const store = new LocalStore(path); const service = new WatchService(store, store);
  const slot = Math.floor(Date.now() / WATCH_LIMITS.intervalMs) * WATCH_LIMITS.intervalMs;
  for (let index = 0; index < 12; index++) {
    const showtimeId = String(910000 + index); const screening = fixtureScreening(showtimeId);
    await service.register(screening.showtime.id, async () => screening);
    // Deliver duplicates and delayed older refreshes after the newer current slot.
    const older = { watchId: screening.showtime.id, jobKey: `${screening.showtime.id}:${slot - WATCH_LIMITS.intervalMs}`, scheduledAt: slot - WATCH_LIMITS.intervalMs };
    await store.mutate<Watch, void>(`watch:${screening.showtime.id}`, (watch) => { assert(watch); watch.jobs[older.jobKey] = { key: older.jobKey, scheduledAt: older.scheduledAt, status: "pending", attempts: 0, nextAttemptAt: Date.now() }; return { value: watch, result: undefined }; });
    await store.send({ watchId: screening.showtime.id, jobKey: `${screening.showtime.id}:${slot}`, scheduledAt: slot });
    await store.send(older, Date.now() + 700); await store.send(older, Date.now() + 700);
  }
  const replayStarted = Date.now();
  const a = worker(path, { WATCH_TEST_DELAY_MS: "50" }); const b = worker(path, { WATCH_TEST_DELAY_MS: "50" });
  const [first, second] = await Promise.all([a.done, b.done]); assert.equal(first.code, 0); assert.equal(second.code, 0);
  const events = [first.output, second.output].flatMap((output) => output.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line)));
  const activePids = new Set(events.filter((event) => event.outcome === "stored").map((event) => event.pid)); assert.equal(activePids.size, 2, "Both independent workers must store observations");
  const rows = await service.list(); assert.equal(rows.length, 12);
  for (const watch of rows) { assert.equal(watch.history.length, 2); assert.equal(new Set(watch.history.map((snapshot) => snapshot.jobKey)).size, 2); assert.equal(watch.latest?.scheduledAt, slot); assert.equal(watch.totals.success, 2); }
  assert.equal(store.inspect().length, 0);
  const replayMs = Date.now() - replayStarted;
  const durations = events.filter((event) => event.outcome === "stored").map((event) => event.durationMs as number).sort((x, y) => x - y);
  const twoWorkers = { watches: rows.length, uniqueJobs: 24, deliveries: 48, workerPids: [...activePids], elapsedMs: replayMs, uniqueJobsPerSecond: 24 / (replayMs / 1000), workerDurationP50Ms: durations[Math.floor(durations.length * 0.5)], workerDurationP95Ms: durations[Math.floor(durations.length * 0.95)], duplicateHistory: 0, latestRegressions: 0 };
  store.close();

  const crashPath = join(directory, "crash.sqlite"); const crashStore = new LocalStore(crashPath); const crashService = new WatchService(crashStore, crashStore);
  const screening = fixtureScreening(); await crashService.register(screening.showtime.id, async () => screening);
  const crashed = await worker(crashPath, { WATCH_TEST_LEASE_MS: "500", WATCH_TEST_CRASH_AFTER_STORE: "1" }).done;
  assert.equal(crashed.code, 86); assert.equal((await crashService.get(screening.showtime.id))?.history.length, 1); assert.equal(crashStore.inspect().length, 1);
  await new Promise((done) => setTimeout(done, 550));
  const recovered = await worker(crashPath, { WATCH_TEST_LEASE_MS: "500" }).done;
  assert.equal(recovered.code, 0); assert.match(recovered.output, /duplicate-or-inactive/); assert.equal((await crashService.get(screening.showtime.id))?.history.length, 1); assert.equal(crashStore.inspect().length, 0);
  const crashRecovery = { actualExitCode: crashed.code, historyBeforeReplay: 1, historyAfterReplay: 1, queueRemaining: 0 }; crashStore.close();

  const fencePath = join(directory, "fence.sqlite"); const fenceStore = new LocalStore(fencePath); const fenceService = new WatchService(fenceStore, fenceStore);
  await fenceService.register(screening.showtime.id, async () => screening);
  const slow = worker(fencePath, { WATCH_TEST_LEASE_MS: "300", WATCH_TEST_DELAY_MS: "1000" });
  await waitUntil(async () => Object.values((await fenceService.get(screening.showtime.id))!.jobs).some((job) => job.status === "running"));
  await new Promise((done) => setTimeout(done, 350));
  const replacement = worker(fencePath, { WATCH_TEST_LEASE_MS: "300" });
  const [oldResult, newResult] = await Promise.all([slow.done, replacement.done]);
  assert.equal(oldResult.code, 0); assert.equal(newResult.code, 0); assert.match(oldResult.output, /"outcome":"fenced"/); assert.match(newResult.output, /"outcome":"stored"/);
  const fencedWatch = (await fenceService.get(screening.showtime.id))!; assert.equal(fencedWatch.history.length, 1); assert.equal(fencedWatch.totals.fenced, 1); assert.equal(fencedWatch.totals.success, 1); assert.equal(fenceStore.inspect().length, 0);
  const expiredLease = { oldPid: slow.child.pid, replacementPid: replacement.child.pid, fencedCommits: fencedWatch.totals.fenced, historyEntries: 1 }; fenceStore.close();
  const report = { generatedAt: new Date().toISOString(), environment: { node: process.version, platform: process.platform, arch: process.arch, storage: "SQLite WAL", provider: "synthetic replay fixtures", collectorDelayMs: 50, workloadLeaseMs: 2000, clock: "process wall clock" }, twoWorkers, crashRecovery, expiredLease, totalElapsedMs: Date.now() - started, cloudDeployed: false };
  const evidence = resolve("docs/evidence"); await mkdir(evidence, { recursive: true });
  await writeFile(join(evidence, "watch-replay.json"), JSON.stringify(report, null, 2) + "\n"); await writeFile(join(evidence, "watch-replay.log"), logs.join("\n") + "\n"); console.log(JSON.stringify(report, null, 2));
} finally {
  for (const child of children) child.kill();
  // Only remove the exact mkdtemp path owned by this run.
  assert(resolve(directory).startsWith(resolve(tmpdir()) + sep) && basename(directory).startsWith("howmanyseats-replay-"), "Cleanup must stay within the run's temporary workspace");
  await rm(directory, { recursive: true, force: true });
}
