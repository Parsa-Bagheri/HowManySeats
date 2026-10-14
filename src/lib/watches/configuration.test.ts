import assert from "node:assert/strict";
import test from "node:test";
import { awsWatchClientOptions } from "./aws-client";
import { watchConfiguration } from "./configuration";

const env = { VERCEL: "1", WATCH_BACKEND: "aws", WATCH_DEPLOYMENT: "production", WATCH_MODE: "live", WATCH_AWS_REGION: "us-east-2", WATCH_AWS_AUTH: "service-key", WATCH_AWS_ACCESS_KEY_ID: "fake-service-key", WATCH_AWS_SECRET_ACCESS_KEY: "fake-service-secret", WATCH_TABLE: "table", WATCH_QUEUE_URL: "queue", WATCH_DLQ_URL: "dlq", WATCH_MAX_ACTIVE: "3", WATCH_MAX_REGISTRATIONS: "6", WATCH_POLLING_END_DATE: "2026-10-14T22:00:00Z" };
test("disabled defaults and local fixture mode remain available", () => {
  assert.equal(watchConfiguration({}).enabled, false);
  assert.equal(watchConfiguration({ WATCH_BACKEND: "local", WATCH_MODE: "fixture" }).fixture, true);
});
test("Vercel production uses explicit live AWS resources and bounded quotas", () => {
  const config = watchConfiguration(env);
  assert.equal(config.enabled, true); assert.equal(config.fixture, false); assert.equal(config.production, true);
  assert.equal(watchConfiguration({ ...env, AWS_ACCESS_KEY_ID: "platform-value", AWS_SECRET_ACCESS_KEY: "platform-value", AWS_SESSION_TOKEN: "platform-value" }).enabled, true);
  assert.equal(config.endAt, Date.parse(env.WATCH_POLLING_END_DATE));
  // Ended configurations still allow reads of retained history; service controls collection.
  assert.equal(watchConfiguration({ ...env, WATCH_POLLING_END_DATE: "2020-01-01T00:00:00Z" }).enabled, true);
});
test("hosted paths reject SQLite, fixtures, default-region fallback and missing scoped service credentials", () => {
  for (const change of [{ WATCH_BACKEND: "local" }, { WATCH_MODE: "fixture" }, { WATCH_DEPLOYMENT: undefined }, { WATCH_AWS_AUTH: undefined }, { WATCH_AWS_ACCESS_KEY_ID: undefined }, { WATCH_AWS_SECRET_ACCESS_KEY: undefined }, { WATCH_AWS_REGION: undefined, AWS_REGION: "us-west-1" }]) assert.throws(() => watchConfiguration({ ...env, ...change }));
});
test("production fails closed when quotas, resources, mode or end date are missing", () => {
  for (const change of [{ WATCH_MAX_ACTIVE: "4" }, { WATCH_MAX_REGISTRATIONS: "7" }, { WATCH_MAX_ACTIVE: "0" }, { WATCH_MAX_REGISTRATIONS: undefined }, { WATCH_TABLE: undefined }, { WATCH_QUEUE_URL: undefined }, { WATCH_DLQ_URL: undefined }, { WATCH_POLLING_END_DATE: undefined }, { WATCH_POLLING_END_DATE: "2026-02-30T00:00:00Z" }, { WATCH_MODE: undefined }]) assert.throws(() => watchConfiguration({ ...env, ...change }));
});

test("AWS clients pin the region and choose scoped credentials over ambient hosted credentials", () => {
  const options = awsWatchClientOptions({ ...env, AWS_REGION: "us-west-1", AWS_ACCESS_KEY_ID: "ambient", AWS_SECRET_ACCESS_KEY: "ambient", AWS_SESSION_TOKEN: "ambient" });
  assert.equal(options.region, "us-east-2"); assert.deepEqual(options.credentials, { accessKeyId: env.WATCH_AWS_ACCESS_KEY_ID, secretAccessKey: env.WATCH_AWS_SECRET_ACCESS_KEY });
  assert.deepEqual(awsWatchClientOptions({ ...env, VERCEL: undefined }).credentials, options.credentials);
  assert.equal(awsWatchClientOptions({ ...env, VERCEL: undefined, WATCH_AWS_AUTH: undefined, WATCH_AWS_ACCESS_KEY_ID: undefined, WATCH_AWS_SECRET_ACCESS_KEY: undefined, AWS_REGION: "us-west-1" }).credentials, undefined);
});
