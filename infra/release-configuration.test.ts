import assert from "node:assert/strict";
import test from "node:test";
import { releaseConfiguration } from "./release-configuration";

const now = Date.parse("2026-10-13T22:00:00Z");
const production = { watchDeployment: "production", enableLive: "true", refreshMinutes: "5", maxActive: "3", maxRegistrations: "6", workerConcurrency: "2", pollingEndDate: "2026-10-14T22:00:00Z" };
test("demo defaults remain fixture/disabled with the original fifteen-minute guard", () => {
  const config = releaseConfiguration({}, now);
  assert.equal(config.live, false); assert.deepEqual(config.schedule, { state: "DISABLED" });
  assert.throws(() => releaseConfiguration({ enableLive: "true", enablePolling: "true", pollingEndDate: production.pollingEndDate }, now), /15 minutes/);
});
test("production must be explicitly selected, live, bounded, and remains disabled by default", () => {
  assert.equal(releaseConfiguration(production, now).schedule.state, "DISABLED");
  assert.equal(releaseConfiguration({ ...production, enablePolling: "true" }, now).schedule.state, "ENABLED");
  assert.equal(releaseConfiguration(production, now).schedule.endDate, "2026-10-14T22:00:00.000Z");
});
test("production rejects missing decisions and exceeded ceilings without changing demo safeguards", () => {
  for (const change of [{ enableLive: undefined }, { refreshMinutes: undefined }, { refreshMinutes: "1" }, { maxActive: "4" }, { maxRegistrations: "7" }, { workerConcurrency: "3" }, { workerConcurrency: "1" }, { maxActive: undefined }, { pollingEndDate: undefined }, { pollingEndDate: "2026-10-14T22:00:00.001Z" }, { pollingEndDate: "2026-10-13T22:00:00Z" }, { watchDeployment: "typo" }]) assert.throws(() => releaseConfiguration({ ...production, ...change }, now));
});
