import assert from "node:assert/strict";
import test from "node:test";
import { DynamoDBDocumentClient, GetCommand, PutCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { DynamoStore } from "./aws";
import { processBatch, api } from "../../aws/handlers";
import { LocalStore } from "./local";
import { WatchService } from "./service";
import { fixtureCollector, fixtureScreening } from "./fixtures";
import type { SQSEvent } from "aws-lambda";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";

class FakeDynamo {
  rows = new Map<string, Record<string, unknown>>(); throttle = 0; puts = 0; conflicts = 0;
  async send(command: GetCommand | PutCommand | TransactWriteCommand) {
    if (command instanceof GetCommand) return { Item: structuredClone(this.rows.get(command.input.Key!.pk as string)) };
    if (this.throttle-- > 0) throw Object.assign(new Error("Injected throttling"), { name: "ThrottlingException" });
    const puts = command instanceof PutCommand ? [command.input] : command.input.TransactItems!.map((item) => item.Put!);
    for (const put of puts) {
      const current = this.rows.get(put.Item!.pk as string); const expected = put.ExpressionAttributeValues?.[":version"];
      if ((expected === undefined && current) || (expected !== undefined && current?.version !== expected)) { this.conflicts++; throw Object.assign(new Error("Injected conflict"), { name: "ConditionalCheckFailedException" }); }
    }
    for (const put of puts) { this.puts++; this.rows.set(put.Item!.pk as string, structuredClone(put.Item!)); }
    return {};
  }
}
test("Dynamo CAS retries concurrent updates without losing either mutation", async () => {
  const fake = new FakeDynamo(); const store = new DynamoStore("test-table", fake as unknown as DynamoDBDocumentClient);
  await Promise.all([store.mutate<{ count: number }, void>("counter", (value = { count: 0 }) => ({ value: { count: value.count + 1 }, result: undefined })), store.mutate<{ count: number }, void>("counter", (value = { count: 0 }) => ({ value: { count: value.count + 1 }, result: undefined }))]);
  assert.equal((await store.get<{ count: number }>("counter"))?.count, 2); assert(fake.conflicts >= 1);
});
test("Dynamo pair writes remain atomic and bounded throttling recovers", async () => {
  const fake = new FakeDynamo(); const store = new DynamoStore("test-table", fake as unknown as DynamoDBDocumentClient); fake.throttle = 2;
  await store.mutatePair<{ expires: number }, { registered: boolean }, void>(["registry", "watch"], () => ({ values: [{ expires: 123 }, { registered: true }], result: undefined }));
  assert.equal((await store.get<{ expires: number }>("registry"))?.expires, 123); assert.equal((await store.get<{ registered: boolean }>("watch"))?.registered, true); assert.equal(fake.puts, 2);
  fake.throttle = 100;
  await assert.rejects(store.mutate("counter", () => ({ value: 1, result: undefined })), /Injected throttling/); assert.equal(await store.get("counter"), undefined);
});
test("Lambda mixed batches acknowledge successful records and retry only failed records", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "watch-batch-")); const store = new LocalStore(join(directory, "db.sqlite")); const service = new WatchService(store, store);
  t.after(async () => { store.close(); assert(resolve(directory).startsWith(resolve(tmpdir()) + sep)); await rm(directory, { recursive: true, force: true }); });
  for (const id of ["900001", "900003"]) { const screening = fixtureScreening(id); await service.register(screening.showtime.id, async () => screening); }
  const first = (await store.claim(30_000))!; const second = (await store.claim(30_000))!;
  const event = { Records: [first, second].map((delivery) => ({ messageId: delivery.id, receiptHandle: delivery.receipt, body: JSON.stringify(delivery.message), attributes: { SentTimestamp: String(delivery.enqueuedAt) } })) } as SQSEvent;
  const result = await processBatch(event, service, fixtureCollector);
  const failedId = [first, second].find((delivery) => delivery.message.watchId.endsWith("900003"))!.id;
  assert.deepEqual(result.batchItemFailures, [{ itemIdentifier: failedId }]); assert.equal((await service.get("cineplex-7402-900001"))!.history.length, 1); assert.equal((await service.get("cineplex-7402-900003"))!.lastFailure?.code, "timeout");
});
test("AWS operations reject unknown actions before resource initialization", async () => {
  await assert.rejects(api({ action: "unexpected" } as unknown as Parameters<typeof api>[0]));
});
