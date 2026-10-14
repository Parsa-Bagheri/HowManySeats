import type { CfnScheduleProps } from "aws-cdk-lib/aws-scheduler";
import { z } from "zod";

const MAX_POLLING_WINDOW_MS = 15 * 60_000;
const timestamp = z.string().datetime({ offset: true });

export function pollingWindow(enabled: boolean, endDate: unknown, now = Date.now()): Pick<CfnScheduleProps, "state" | "endDate"> {
  if (!enabled) return { state: "DISABLED" };
  if (!timestamp.safeParse(endDate).success) throw new Error("Enabling polling requires pollingEndDate as a valid ISO timestamp.");
  const end = Date.parse(endDate as string);
  if (!Number.isFinite(end) || end <= now) throw new Error("pollingEndDate must be in the future.");
  if (end > now + MAX_POLLING_WINDOW_MS) throw new Error("pollingEndDate must be no more than 15 minutes in the future.");
  return { state: "ENABLED", endDate: new Date(end).toISOString() };
}
