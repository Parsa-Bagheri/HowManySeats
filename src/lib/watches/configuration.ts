import { z } from "zod";
import { WatchError } from "./model";

type Environment = Record<string, string | undefined>;
export function watchConfiguration(env: Environment = process.env) {
  const hosted = env.VERCEL === "1";
  const production = env.WATCH_DEPLOYMENT === "production";
  const backend = env.WATCH_BACKEND;
  if (!backend) return { enabled: false, fixture: false, production, endAt: undefined };
  if (!["local", "aws"].includes(backend)) throw new WatchError(503, "Invalid watch backend configuration.");
  if (hosted && backend !== "aws") throw new WatchError(503, "Hosted watches require AWS storage.");
  if ((hosted || production) && env.WATCH_MODE !== "live") throw new WatchError(503, "Hosted and production watches require live provider data.");
  if (hosted && (!production || env.WATCH_AWS_AUTH !== "service-key" || !env.WATCH_AWS_ACCESS_KEY_ID || !env.WATCH_AWS_SECRET_ACCESS_KEY)) throw new WatchError(503, "Hosted watches require scoped server-side service credentials.");
  if (env.WATCH_AWS_AUTH && env.WATCH_AWS_AUTH !== "service-key") throw new WatchError(503, "Invalid watch credential configuration.");
  if (env.WATCH_AWS_AUTH === "service-key" && (!production || !env.WATCH_AWS_ACCESS_KEY_ID || !env.WATCH_AWS_SECRET_ACCESS_KEY)) throw new WatchError(503, "Scoped production credentials are incomplete.");
  let endAt: number | undefined;
  if (production) {
    if (backend !== "aws") throw new WatchError(503, "Production watches require AWS storage.");
    if (!z.string().datetime({ offset: true }).safeParse(env.WATCH_POLLING_END_DATE).success) throw new WatchError(503, "Production watches require an operating end date.");
    endAt = Date.parse(env.WATCH_POLLING_END_DATE!);
    for (const [name, maximum] of [["WATCH_MAX_ACTIVE", 3], ["WATCH_MAX_REGISTRATIONS", 6]] as const) {
      const value = Number(env[name]);
      if (!Number.isInteger(value) || value < 1 || value > maximum) throw new WatchError(503, `Invalid production ${name}.`);
    }
  }
  if (backend === "aws" && (!env.WATCH_TABLE || !env.WATCH_QUEUE_URL || !env.WATCH_DLQ_URL || !(env.WATCH_AWS_REGION || (!hosted && env.AWS_REGION)))) throw new WatchError(503, "AWS watch resources and region must be configured.");
  return { enabled: true, fixture: env.WATCH_MODE === "fixture", production, endAt };
}
