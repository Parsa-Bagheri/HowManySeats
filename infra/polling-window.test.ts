import assert from "node:assert/strict";
import test from "node:test";
import { App, Stack } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { CfnSchedule } from "aws-cdk-lib/aws-scheduler";
import { pollingWindow } from "./polling-window";

const now = Date.parse("2026-10-13T22:00:00.000Z");

test("polling remains disabled without an end date", () => {
  assert.deepEqual(pollingWindow(false, undefined, now), { state: "DISABLED" });
});
test("enabled polling rejects a missing or invalid ISO end date", () => {
  for (const value of [undefined, "", "not-a-date", "2026-10-13", "2026-02-30T22:10:00Z", now + 60_000]) {
    assert.throws(() => pollingWindow(true, value, now), /valid ISO timestamp/);
  }
});
test("enabled polling rejects past or current end dates", () => {
  for (const offset of [-1, 0]) assert.throws(() => pollingWindow(true, new Date(now + offset).toISOString(), now), /must be in the future/);
});
test("enabled polling rejects a window longer than fifteen minutes", () => {
  assert.throws(() => pollingWindow(true, new Date(now + 15 * 60_000 + 1).toISOString(), now), /no more than 15 minutes/);
});
test("a valid bounded window normalizes ISO offsets and accepts the maximum boundary", () => {
  assert.deepEqual(pollingWindow(true, "2026-10-13T18:10:00-04:00", now), { state: "ENABLED", endDate: "2026-10-13T22:10:00.000Z" });
  assert.equal(pollingWindow(true, "2026-10-13T22:15:00Z", now).endDate, "2026-10-13T22:15:00.000Z");
});
test("the synthesized recurring schedule has an enforced EndDate", () => {
  const stack = new Stack(new App(), "BoundedPollingTest");
  new CfnSchedule(stack, "RefreshSchedule", {
    scheduleExpression: "rate(5 minutes)", flexibleTimeWindow: { mode: "OFF" },
    ...pollingWindow(true, "2026-10-13T22:10:00Z", now),
    target: { arn: "arn:aws:lambda:us-east-2:123456789012:function:test", roleArn: "arn:aws:iam::123456789012:role/test" },
  });
  Template.fromStack(stack).hasResourceProperties("AWS::Scheduler::Schedule", {
    State: "ENABLED", EndDate: "2026-10-13T22:10:00.000Z", ScheduleExpression: "rate(5 minutes)",
  });
});
