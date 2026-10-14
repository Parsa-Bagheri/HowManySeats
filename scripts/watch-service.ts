import { resolve } from "node:path";
import { writeFile } from "node:fs/promises";
import { LocalStore } from "../src/lib/watches/local";
import { WatchService } from "../src/lib/watches/service";
import { fixtureCollector } from "../src/lib/watches/fixtures";
import { cineplexCollector } from "../src/lib/watches/collector";
import { watchState, WATCH_LIMITS, type Collector } from "../src/lib/watches/model";
import { resolveScreening } from "../src/lib/watches/runtime";

const [command, argument] = process.argv.slice(2);
const store = new LocalStore(resolve(process.env.WATCH_DB_PATH ?? ".watch-data/watches.sqlite"));
const service = new WatchService(store, store);
const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));
let stopped = false;
process.on("SIGINT", () => { stopped = true; }); process.on("SIGTERM", () => { stopped = true; });
try {
  if (command === "worker") {
    const leaseMs = Number(process.env.WATCH_TEST_LEASE_MS ?? WATCH_LIMITS.leaseMs);
    if (!Number.isFinite(leaseMs) || leaseMs < 100) throw new Error("Invalid lease duration");
    if (process.env.WATCH_TEST_LEASE_MS && process.env.WATCH_MODE !== "fixture") throw new Error("Short test leases require fixture mode");
    const collect: Collector = process.env.WATCH_MODE === "fixture" ? fixtureCollector : cineplexCollector;
    const idleExit = Number(process.argv.find((arg) => arg.startsWith("--idle-exit-ms="))?.split("=")[1] ?? 0);
    let lastWorkAt = Date.now();
    while (!stopped) {
      const delivery = await store.claim(leaseMs);
      if (!delivery) {
        if (idleExit && Date.now() - lastWorkAt >= idleExit) break;
        await sleep(50); continue;
      }
      lastWorkAt = Date.now(); const started = Date.now();
      const outcome = await service.process(delivery, async (screening) => {
        if (process.env.WATCH_MODE === "fixture" && process.env.WATCH_TEST_DELAY_MS) await sleep(Number(process.env.WATCH_TEST_DELAY_MS));
        return collect(screening);
      }, { leaseMs, afterStore: async () => {
        if (process.env.WATCH_MODE === "fixture" && process.env.WATCH_TEST_CRASH_AFTER_STORE === "1") {
          console.log(JSON.stringify({ event: "crash-after-store", pid: process.pid, jobKey: delivery.message.jobKey }));
          process.exit(86);
        }
      } });
      console.log(JSON.stringify({ event: "refresh", pid: process.pid, watchId: delivery.message.watchId, jobKey: delivery.message.jobKey, outcome, queueAgeMs: started - delivery.enqueuedAt, durationMs: Date.now() - started }));
    }
  } else if (command === "dispatcher") {
    do {
      await service.dispatch(); store.cleanup();
      console.log(JSON.stringify({ event: "dispatch", pid: process.pid, at: new Date().toISOString() }));
      if (argument === "--once") break;
      await sleep(10_000);
    } while (!stopped);
  } else if (command === "demo") {
    if (process.env.WATCH_MODE !== "fixture") throw new Error("Demo registration requires WATCH_MODE=fixture");
    for (const id of ["900001", "900002", "900003", "900005"]) await service.register(`cineplex-7402-${id}`, () => resolveScreening("7402", id));
    console.log("Demo watches registered. Add them on /watches using the fixture demo buttons.");
  } else if (command === "pause" || command === "resume") {
    if (!argument) throw new Error("Supply a screening watch ID");
    await service.pause(argument, command === "pause");
    console.log(`${argument}: ${command === "pause" ? "paused" : "resumed"}`);
  } else if (command === "inspect" || command === "export") {
    const watches = (await service.list()).map((watch) => ({ ...watch, state: watchState(watch), observationAgeMs: watch.latest ? Date.now() - watch.latest.observedAt : null }));
    const report = JSON.stringify({ generatedAt: new Date().toISOString(), watches, queue: store.inspect() }, null, 2);
    if (command === "export") { if (!argument) throw new Error("Supply an export path"); await writeFile(resolve(argument), report); }
    else console.log(report);
  } else throw new Error("Use worker, dispatcher [--once], demo, inspect, export <path>, pause <id> or resume <id>.");
} finally { store.close(); }
