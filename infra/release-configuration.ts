import { z } from "zod";
import { pollingWindow } from "./polling-window";

export function releaseConfiguration(context: Record<string, unknown>, now = Date.now()) {
  const stage = context.watchDeployment ?? "demo";
  if (stage !== "demo" && stage !== "production") throw new Error("watchDeployment must be demo or production.");
  const live = context.enableLive === "true";
  const polling = context.enablePolling === "true";
  if (polling && !live) throw new Error("Polling requires an explicitly verified live provider environment.");
  if (stage === "demo") return { stage, live, active: 3, registrations: 6, concurrency: 2, schedule: pollingWindow(polling, context.pollingEndDate, now), operatingEndDate: undefined };
  if (!live) throw new Error("Production requires enableLive=true.");
  if (context.refreshMinutes !== "5") throw new Error("The approved production configuration requires refreshMinutes=5.");
  const endDate = context.pollingEndDate;
  if (!z.string().datetime({ offset: true }).safeParse(endDate).success) throw new Error("Production requires a valid pollingEndDate even when its schedule is disabled.");
  const end = Date.parse(endDate as string);
  if (end <= now || end > now + 24 * 60 * 60_000) throw new Error("Production operating window must end within the next 24 hours.");
  function bounded(name: string, ceiling: number) {
    const value = Number(context[name]);
    if (!Number.isInteger(value) || value < 1 || value > ceiling) throw new Error(`Specify ${name} between 1 and ${ceiling}.`);
    return value;
  }
  return { stage, live, active: bounded("maxActive", 3), registrations: bounded("maxRegistrations", 6), concurrency: (() => { if (context.workerConcurrency !== "2") throw new Error("workerConcurrency must be 2 for the bounded SQS event source."); return 2; })(), operatingEndDate: new Date(end).toISOString(), schedule: { state: polling ? "ENABLED" : "DISABLED", endDate: new Date(end).toISOString() } };
}
