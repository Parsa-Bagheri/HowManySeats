import { NextResponse } from "next/server";
import { z } from "zod";
import { WatchError, watchState } from "@/lib/watches/model";
import { watchConfiguration } from "@/lib/watches/configuration";
import { resolveScreening, watchRuntime } from "@/lib/watches/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const idSchema = z.string().regex(/^cineplex-\d{1,10}-\d{1,20}$/);
const registrationSchema = z.object({ theatreId: z.string().regex(/^\d{1,10}$/), showtimeId: z.string().regex(/^\d{1,20}$/) }).strict();

export async function GET(request: Request) {
  const url = new URL(request.url);
  if (url.searchParams.has("status")) {
    let context;
    try {
      const configuration = watchConfiguration();
      context = configuration.enabled ? await watchRuntime() : undefined;
      return NextResponse.json({ enabled: configuration.enabled, fixture: configuration.fixture, accepting: context ? await context.service.operating() : false, endDate: configuration.endAt ? new Date(configuration.endAt).toISOString() : null }, { headers: { "Cache-Control": "no-store" } });
    } catch (error) { return failure(error); }
    finally { context?.close(); }
  }
  const ids = url.searchParams.getAll("id");
  if (!ids.length || ids.length > 10 || ids.some((id) => !idSchema.safeParse(id).success)) return NextResponse.json({ error: "Request up to ten valid screening watches." }, { status: 400 });
  let context;
  try {
    context = await watchRuntime();
    const watches = await Promise.all(ids.map((id) => context!.service.get(id)));
    const operating = await context.service.operating();
    return NextResponse.json({ watches: watches.filter(Boolean).map((watch) => ({ ...watch!, state: !operating && watchState(watch!) !== "ended" ? "paused" : watchState(watch!), fixture: process.env.WATCH_MODE === "fixture" })) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return failure(error); }
  finally { context?.close(); }
}
export async function POST(request: Request) {
  let context;
  try {
    if ((request.headers.get("content-length") && Number(request.headers.get("content-length")) > 1024)) throw new WatchError(400, "Send only screening identifiers.");
    const parsed = registrationSchema.safeParse(await boundedJson(request));
    if (!parsed.success) throw new WatchError(400, "Send valid Cineplex theatre and showtime identifiers.");
    context = await watchRuntime();
    const { theatreId, showtimeId } = parsed.data;
    const watch = await context.service.register(`cineplex-${theatreId}-${showtimeId}`, () => resolveScreening(theatreId, showtimeId));
    return NextResponse.json({ watch: { ...watch, state: watchState(watch), fixture: process.env.WATCH_MODE === "fixture" } }, { status: 201 });
  } catch (error) { return failure(error); }
  finally { context?.close(); }
}
function failure(error: unknown) {
  if (error instanceof WatchError) return NextResponse.json({ error: error.message }, { status: error.status });
  if (error instanceof SyntaxError) return NextResponse.json({ error: "Send a valid screening request." }, { status: 400 });
  console.error("Watch service failed", error instanceof Error ? error.name : "unknown");
  return NextResponse.json({ error: "The watch service is temporarily unavailable. Try again." }, { status: 502 });
}
async function boundedJson(request: Request): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) throw new WatchError(400, "Send a screening request.");
  const chunks: Uint8Array[] = []; let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > 1024) { await reader.cancel(); throw new WatchError(400, "Send only screening identifiers."); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder().decode(bytes));
}
