import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { ChangeMessageVisibilityCommand, SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import type { Delivery, DocumentStore, DurableQueue, Message } from "./model";
import { WatchService } from "./service";

type Item = { pk: string; value: unknown; version: number; expiresAt?: number };
export class DynamoStore implements DocumentStore {
  constructor(private readonly table: string, private readonly client = DynamoDBDocumentClient.from(new DynamoDBClient({}), { marshallOptions: { removeUndefinedValues: true } })) {}
  private async read(key: string): Promise<Item | undefined> {
    const response = await this.client.send(new GetCommand({ TableName: this.table, Key: { pk: key }, ConsistentRead: true }));
    return response.Item as Item | undefined;
  }
  async get<T>(key: string) { return (await this.read(key))?.value as T | undefined; }
  async mutate<T, R>(key: string, change: (current: T | undefined) => { value: T; result: R }, expiresAt?: number): Promise<R> {
    return this.retry(async () => {
      const previous = await this.read(key);
      const changed = change(previous?.value as T | undefined);
      await this.client.send(new PutCommand({ TableName: this.table, ...this.write(key, previous, changed.value, expiresAt) }));
      return changed.result;
    });
  }
  async mutatePair<A, B, R>(keys: [string, string], change: (a: A | undefined, b: B | undefined) => { values: [A, B]; result: R }, expiresAt?: [number | undefined, number | undefined]): Promise<R> {
    return this.retry(async () => {
      const previous = await Promise.all(keys.map((key) => this.read(key)));
      const changed = change(previous[0]?.value as A | undefined, previous[1]?.value as B | undefined);
      await this.client.send(new TransactWriteCommand({ TransactItems: keys.map((key, index) => ({ Put: { TableName: this.table, ...this.write(key, previous[index], changed.values[index], expiresAt?.[index]) } })) }));
      return changed.result;
    });
  }
  private write(key: string, previous: Item | undefined, value: unknown, expiresAt?: number) {
    const ttl = expiresAt ? Math.floor(expiresAt / 1000) : previous?.expiresAt;
    return {
      Item: { pk: key, value, version: (previous?.version ?? 0) + 1, ...(ttl ? { expiresAt: ttl } : {}) },
      ConditionExpression: previous ? "#v = :version" : "attribute_not_exists(pk)",
      ...(previous ? { ExpressionAttributeNames: { "#v": "version" }, ExpressionAttributeValues: { ":version": previous.version } } : {}),
    };
  }
  private async retry<R>(action: () => Promise<R>): Promise<R> {
    for (let attempt = 0; ; attempt++) {
      try { return await action(); }
      catch (error) {
        const name = error instanceof Error ? error.name : "";
        if (attempt >= 7 || !["ConditionalCheckFailedException", "TransactionCanceledException", "ProvisionedThroughputExceededException", "ThrottlingException", "RequestLimitExceeded"].includes(name)) throw error;
        await new Promise((resolve) => setTimeout(resolve, Math.min(250, 5 * 2 ** attempt) + Math.floor(Math.random() * 10)));
      }
    }
  }
}
export class SqsQueue implements DurableQueue {
  constructor(private readonly url: string, private readonly dlqUrl: string, private readonly client = new SQSClient({})) {}
  async send(message: Message, availableAt = Date.now()) {
    await this.client.send(new SendMessageCommand({ QueueUrl: this.url, MessageBody: JSON.stringify(message), DelaySeconds: Math.min(900, Math.max(0, Math.ceil((availableAt - Date.now()) / 1000))) }));
  }
  async acknowledge(_delivery: Delivery) { /* Lambda deletes successful records using its batch response. */ }
  async retry(delivery: Delivery, availableAt: number) {
    await this.client.send(new ChangeMessageVisibilityCommand({ QueueUrl: this.url, ReceiptHandle: delivery.receipt, VisibilityTimeout: Math.min(43_200, Math.max(1, Math.ceil((availableAt - Date.now()) / 1000))) }));
  }
  async deadLetter(delivery: Delivery, reason: string) {
    await this.client.send(new SendMessageCommand({ QueueUrl: this.dlqUrl, MessageBody: JSON.stringify({ ...delivery.message, reason }) }));
  }
}
export function awsRuntime() {
  const table = process.env.WATCH_TABLE; const queueUrl = process.env.WATCH_QUEUE_URL; const dlqUrl = process.env.WATCH_DLQ_URL;
  if (!table || !queueUrl || !dlqUrl) throw new Error("AWS watch resources are not configured");
  return { service: new WatchService(new DynamoStore(table), new SqsQueue(queueUrl, dlqUrl)), close: () => {} };
}
