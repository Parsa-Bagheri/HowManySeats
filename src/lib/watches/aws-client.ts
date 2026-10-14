import { watchConfiguration } from "./configuration";

export function awsWatchClientOptions(env: Record<string, string | undefined> = process.env) {
  watchConfiguration(env);
  // Explicit named credentials and region prevent the SDK from selecting
  // Vercel's unrelated AWS_* values or a developer's temporary CLI session.
  return { region: env.WATCH_AWS_REGION ?? env.AWS_REGION, ...(env.WATCH_AWS_AUTH === "service-key" ? { credentials: { accessKeyId: env.WATCH_AWS_ACCESS_KEY_ID!, secretAccessKey: env.WATCH_AWS_SECRET_ACCESS_KEY! } } : {}) };
}
