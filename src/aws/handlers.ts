import type { SQSEvent, SQSBatchResponse } from "aws-lambda";
import { z } from "zod";
import { awsRuntime } from "../lib/watches/aws";
import { cineplexCollector } from "../lib/watches/collector";
import { fixtureCollector } from "../lib/watches/fixtures";
import { resolveScreening } from "../lib/watches/runtime";
import { watchState } from "../lib/watches/model";

const messageSchema = z.object({ watchId: z.string().regex(/^cineplex-\d{1,10}-\d{1,20}$/), jobKey: z.string().max(200), scheduledAt: z.number().int().nonnegative() }).strict();
export async function dispatcher() {
  const { service } = awsRuntime(); await service.dispatch();
  console.log(JSON.stringify({ event: "dispatch", at: new Date().toISOString() }));
}
export async function collector(event: SQSEvent): Promise<SQSBatchResponse> {
  const { service } = awsRuntime();
  return processBatch(event, service, process.env.WATCH_MODE === "fixture" ? fixtureCollector : cineplexCollector);
}
export async function processBatch(event: SQSEvent, service: import("../lib/watches/service").WatchService, collect: import("../lib/watches/model").Collector): Promise<SQSBatchResponse> {
  const batchItemFailures: SQSBatchResponse["batchItemFailures"] = [];
  for (const record of event.Records) {
    const started = Date.now();
    try {
      const message = messageSchema.parse(JSON.parse(record.body));
      const outcome = await service.process({ id: record.messageId, receipt: record.receiptHandle, message, enqueuedAt: Number(record.attributes.SentTimestamp) }, collect);
      if (["retry", "busy", "fenced"].includes(outcome)) batchItemFailures.push({ itemIdentifier: record.messageId });
      const watch = await service.get(message.watchId);
      console.log(JSON.stringify({ event: "refresh", watchId: message.watchId, jobKey: message.jobKey, outcome, queueAgeMs: started - Number(record.attributes.SentTimestamp), durationMs: Date.now() - started, observationAgeMs: watch?.latest ? Date.now() - watch.latest.observedAt : null, namespace: "HowManySeats/Watches" }));
    } catch (error) {
      batchItemFailures.push({ itemIdentifier: record.messageId });
      console.error(JSON.stringify({ event: "refresh-handler-error", outcome: "handler-error", messageId: record.messageId, error: error instanceof Error ? error.name : "unknown" }));
    }
  }
  return { batchItemFailures };
}

// Invoke with IAM credentials for isolated demos/operations. No public unauthenticated Lambda URL.
export async function api(event: { action: "register" | "get" | "pause" | "probe" | "pauseAll"; theatreId?: string; showtimeId?: string; id?: string; paused?: boolean }) {
  z.enum(["register", "get", "pause", "probe", "pauseAll"]).parse(event.action);
  const { service } = awsRuntime();
  if (event.action === "pauseAll") { await service.pauseAll(z.boolean().parse(event.paused)); return { operating: await service.operating() }; }
  if (event.action === "get") {
    const watch = await service.get(z.string().regex(/^cineplex-\d{1,10}-\d{1,20}$/).parse(event.id));
    return watch ? { ...watch, state: watchState(watch) } : undefined;
  }
  if (event.action === "pause") return service.pause(z.string().regex(/^cineplex-\d{1,10}-\d{1,20}$/).parse(event.id), z.boolean().parse(event.paused));
  const theatreId = z.string().regex(/^\d{1,10}$/).parse(event.theatreId);
  const showtimeId = z.string().regex(/^\d{1,20}$/).parse(event.showtimeId);
  if (event.action === "probe") {
    // Explicit one-screening read-only probe verifies collection from Lambda's actual network.
    const { CineplexClient } = await import("../lib/cineplex-client");
    const screening = await new CineplexClient().resolveScreening(theatreId, showtimeId);
    if (!screening) throw new Error("Provider did not confirm screening");
    return { screeningId: screening.showtime.id, observation: await cineplexCollector(screening), probedAt: new Date().toISOString() };
  }
  return service.register(`cineplex-${theatreId}-${showtimeId}`, () => resolveScreening(theatreId, showtimeId));
}
