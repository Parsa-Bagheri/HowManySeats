import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fixtureScreening } from "../src/lib/watches/fixtures";
import { buildSeatSnapshot } from "../src/lib/seat-scoring";
import { WATCH_LIMITS, type Watch } from "../src/lib/watches/model";

type Resource = { Type: string; Properties: Record<string, unknown> };
const template = JSON.parse(await readFile("cdk.out/HowManySeatsWatchDemo.template.json", "utf8")) as { Resources: Record<string, Resource> };
const resources = Object.values(template.Resources);
const ofType = (type: string) => resources.filter((resource) => resource.Type === type);
const table = ofType("AWS::DynamoDB::Table")[0]; assert.equal(table.Properties.BillingMode, "PAY_PER_REQUEST"); assert.deepEqual(table.Properties.OnDemandThroughput, { MaxReadRequestUnits: 64, MaxWriteRequestUnits: 256 });
assert.equal(ofType("AWS::Scheduler::Schedule")[0].Properties.State, "DISABLED");
const mapping = ofType("AWS::Lambda::EventSourceMapping")[0]; assert.equal(mapping.Properties.BatchSize, 1); assert.deepEqual(mapping.Properties.FunctionResponseTypes, ["ReportBatchItemFailures"]); assert.deepEqual(mapping.Properties.ScalingConfig, { MaximumConcurrency: 2 });
const collector = Object.entries(template.Resources).find(([key, resource]) => key.startsWith("Collector") && resource.Type === "AWS::Lambda::Function")![1];
assert.equal(collector.Properties.ReservedConcurrentExecutions, 2); assert.equal(collector.Properties.Timeout, 30);
assert(ofType("AWS::SQS::Queue").some((queue) => queue.Properties.VisibilityTimeout === 180));
const env = collector.Properties.Environment as { Variables: Record<string, string> }; assert.equal(env.Variables.WATCH_MODE, "fixture"); assert.equal(env.Variables.WATCH_MAX_ACTIVE, "3");
assert.equal(ofType("AWS::Lambda::Url").length, 0, "No public function URL");
const iam = JSON.stringify(ofType("AWS::IAM::Policy")); assert(!iam.includes("dynamodb:Scan")); assert(!iam.includes("AdministratorAccess"));
assert.equal(ofType("AWS::CloudWatch::Alarm").length, 3); assert.equal(ofType("AWS::Logs::MetricFilter").length, 4);
const now = Date.now(); const screening = fixtureScreening("900001", now);
const seats = { ...buildSeatSnapshot(Array.from({ length: 40 }, () => ({ type: "Standard", status: "Available" })), new Date(now)), unknownSeats: 0, excludedSeats: 0, partial: false };
const watch: Watch = {
  id: screening.showtime.id, screening, createdAt: now, expiresAt: now + WATCH_LIMITS.durationMs, paused: false, nextRefreshAt: now, retiredBefore: now - 65 * WATCH_LIMITS.intervalMs,
  jobs: Object.fromEntries(Array.from({ length: WATCH_LIMITS.jobs }, (_, index) => { const scheduledAt = now - index * WATCH_LIMITS.intervalMs; const key = `${screening.showtime.id}:${scheduledAt}`; return [key, { key, scheduledAt, status: "complete", attempts: 3, nextAttemptAt: scheduledAt, durationMs: 8000, publishedAt: scheduledAt }]; })),
  history: Array.from({ length: WATCH_LIMITS.history }, (_, index) => ({ jobKey: `${screening.showtime.id}:${now - index * WATCH_LIMITS.intervalMs}`, scheduledAt: now - index * WATCH_LIMITS.intervalMs, observedAt: now, storedAt: now, seats })),
  failures: Array.from({ length: WATCH_LIMITS.history }, (_, index) => ({ jobKey: `${screening.showtime.id}:${now - index * WATCH_LIMITS.intervalMs}`, scheduledAt: now - index * WATCH_LIMITS.intervalMs, at: now, code: "provider-unavailable", message: "Cineplex is temporarily unavailable.", terminal: true })),
  totals: { success: 500, failure: 72, duplicate: 20, fenced: 5 },
};
watch.latest = watch.history[0]; watch.lastFailure = watch.failures[0];
const serializedWatchBytes = Buffer.byteLength(JSON.stringify({ pk: `watch:${watch.id}`, value: watch, version: 100, expiresAt: Math.floor(now / 1000) }));
assert(serializedWatchBytes < 48 * 1024, "Fixture-sized mature aggregates must stay within the documented size envelope");
const report = { generatedAt: new Date().toISOString(), validation: "Local template assertions and bundle synthesis only; no AWS deployment", region: "ca-central-1", defaultPolling: "disabled", defaultCollector: "fixture", cloudActiveWatchLimit: 3, cloudRegistrationsPerHour: 6, workerConcurrency: 2, historyLimit: WATCH_LIMITS.history, jobLimit: WATCH_LIMITS.jobs, failureLimit: WATCH_LIMITS.history, serializedWatchBytes, conservativeItemEnvelopeBytes: 48 * 1024, approximateWriteUnitsPerFullPut: Math.ceil(serializedWatchBytes / 1024), approximateConsistentReadUnits: Math.ceil(serializedWatchBytes / 4096), onDemandThroughputLimits: { read: 64, write: 256 }, limitsAreMoneyCaps: false, alarmCount: 3, customMetricCount: 4, functionCount: ofType("AWS::Lambda::Function").length };
await mkdir("docs/evidence", { recursive: true }); await writeFile("docs/evidence/aws-preparation.json", JSON.stringify(report, null, 2) + "\n"); console.log(JSON.stringify(report, null, 2));
