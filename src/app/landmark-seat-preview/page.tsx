import type { Metadata } from "next";
import Link from "next/link";
import { z } from "zod";
import {
  buildLandmarkPurchaseUrl,
  LandmarkClient,
  type LandmarkSeatPreview,
} from "@/lib/landmark-client";
import { getLandmarkTheatre } from "@/lib/landmark-theatres";

export const dynamic = "force-dynamic";
export const runtime = "edge";

export const metadata: Metadata = {
  title: "Landmark seat preview | HowManySeats?",
  description: "Preview available seats for a Landmark Cinemas showtime.",
};

const previewQuerySchema = z.object({
  cinemaId: z.string().regex(/^\d+$/),
  externalSessionId: z.string().regex(/^\d+$/),
  filmId: z.string().regex(/^\d+$/),
  sessionId: z.string().regex(/^\d+$/),
  startsAt: z.string().datetime(),
  title: z.string().trim().min(1).max(200),
});

type PreviewPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function LandmarkSeatPreviewPage({
  searchParams,
}: PreviewPageProps) {
  const query = await searchParams;
  const parsed = previewQuerySchema.safeParse(
    Object.fromEntries(
      Object.entries(query).map(([key, value]) => [
        key,
        Array.isArray(value) ? value[0] : value,
      ]),
    ),
  );

  if (!parsed.success) {
    return (
      <PreviewShell>
        <PreviewMessage
          headingLevel="h1"
          title="This preview link is invalid"
          message="Return to the search page and open the seat preview again."
        />
      </PreviewShell>
    );
  }

  const theatre = getLandmarkTheatre(parsed.data.cinemaId);

  if (!theatre) {
    return (
      <PreviewShell>
        <PreviewMessage
          headingLevel="h1"
          title="This theater is not supported"
          message="Return to the search page and choose another showtime."
        />
      </PreviewShell>
    );
  }

  const purchaseUrl = buildLandmarkPurchaseUrl(parsed.data);
  let preview: LandmarkSeatPreview | undefined;
  let previewError = false;

  try {
    preview = await new LandmarkClient().getSeatPreview(
      theatre,
      parsed.data.sessionId,
    );
  } catch (error) {
    previewError = true;
    console.error("Landmark seat preview page failed", error);
  }

  const startsAt = new Date(parsed.data.startsAt);

  return (
    <PreviewShell>
      <header className="grid gap-5 border-b border-neutral-800 pb-6 md:grid-cols-[1fr_auto] md:items-end">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.16em] text-amber-300">
            Landmark Cinemas
          </p>
          <h1 className="mt-2 text-3xl font-bold text-white sm:text-4xl">
            {parsed.data.title}
          </h1>
          <p className="mt-3 text-neutral-300">
            {theatre.name} · {theatre.city}, {theatre.province}
          </p>
          <p className="mt-1 text-sm text-neutral-400">
            <time dateTime={parsed.data.startsAt}>
              {startsAt.toLocaleString("en-CA", {
                dateStyle: "full",
                timeZone: theatre.timeZone,
                timeStyle: "short",
              })}
            </time>
          </p>
        </div>
        {purchaseUrl ? (
          <a
            className="focus-ring inline-flex min-h-11 items-center justify-center rounded-md bg-amber-300 px-4 py-2 font-semibold text-black transition hover:bg-amber-200"
            href={purchaseUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            Buy tickets
          </a>
        ) : null}
      </header>

      {previewError || !preview ? (
        <PreviewMessage
          title="Landmark could not load this seat preview"
          message="The preview might be disabled or temporarily unavailable. You can still buy tickets through Landmark Cinemas."
        />
      ) : (
        <SeatMap preview={preview} timeZone={theatre.timeZone} />
      )}
    </PreviewShell>
  );
}

function PreviewShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-[#050505] px-4 py-6 text-neutral-100 sm:px-6 sm:py-10">
      <div className="mx-auto grid w-full max-w-6xl gap-6">
        <Link
          className="focus-ring w-fit rounded-sm text-sm font-semibold text-amber-300 hover:text-amber-200"
          href="/"
        >
          ← Back to search
        </Link>
        <section className="rounded-xl border border-neutral-800 bg-[#111111] p-5 shadow-[0_18px_60px_rgba(0,0,0,0.35)] sm:p-8">
          {children}
        </section>
      </div>
    </main>
  );
}

function PreviewMessage({
  headingLevel: Heading = "h2",
  message,
  title,
}: {
  headingLevel?: "h1" | "h2";
  message: string;
  title: string;
}) {
  return (
    <div className="my-6 rounded-lg border border-neutral-700 bg-neutral-950 p-5" role="status">
      <Heading className="text-xl font-semibold text-white">{title}</Heading>
      <p className="mt-2 max-w-2xl leading-6 text-neutral-300">{message}</p>
    </div>
  );
}

function SeatMap({
  preview,
  timeZone,
}: {
  preview: LandmarkSeatPreview;
  timeZone: string;
}) {
  const openSeats = Math.max(
    0,
    preview.snapshot.sellableSeats - preview.snapshot.occupiedEstimate,
  );

  return (
    <div className="mt-6 grid gap-6">
      <div className="grid gap-3 sm:grid-cols-3">
        <SeatStat label="Open standard seats" value={openSeats} />
        <SeatStat
          label="Occupied estimate"
          value={preview.snapshot.occupiedEstimate}
        />
        <SeatStat
          label="Accessible seats"
          value={preview.snapshot.accessibilityCount}
        />
      </div>

      <div className="rounded-lg border border-neutral-800 bg-black p-3 sm:p-6">
        <div className="mx-auto mb-8 max-w-2xl rounded-b-[100%] border-t-4 border-amber-300 pt-3 text-center text-xs font-semibold uppercase tracking-[0.22em] text-neutral-400">
          Screen
        </div>

        <div className="grid gap-3 overflow-x-auto pb-2">
          {preview.rows.map((row) => (
            <div
              className="grid min-w-max grid-cols-[2rem_1fr] items-center gap-3"
              key={row.label}
            >
              <span className="text-right text-xs font-semibold text-neutral-500">
                {row.label}
              </span>
              <div
                className="flex min-h-7 items-center justify-center gap-1"
                role="list"
                aria-label={`Row ${row.label}`}
              >
                {row.seats.map((seat) => (
                  <span
                    className={seatClassName(seat.status, seat.accessible)}
                    key={seat.id}
                    role="listitem"
                    title={`${seat.label}: ${seat.accessible ? "accessible, " : ""}${seat.status}`}
                    aria-label={`${seat.label}: ${seat.accessible ? "accessible, " : ""}${seat.status}`}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-x-5 gap-y-2 text-xs text-neutral-400">
        <Legend swatch="border-emerald-300 bg-emerald-300/25" label="Available" />
        <Legend swatch="border-neutral-700 bg-neutral-800" label="Unavailable" />
        <Legend swatch="border-sky-300 bg-sky-300/25" label="Accessible" />
      </div>

      <p className="text-xs leading-5 text-neutral-500">
        Checked {formatCheckedAt(preview.checkedAt, timeZone)}. Seat availability can
        change before you complete your purchase.
      </p>
    </div>
  );
}

function formatCheckedAt(value: string, timeZone: string): string {
  return new Date(value)
    .toLocaleString("en-CA", { timeZone })
    .replace(/\.$/, "");
}

function SeatStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-950 p-4">
      <p className="text-2xl font-bold text-white">{value}</p>
      <p className="mt-1 text-sm text-neutral-400">{label}</p>
    </div>
  );
}

function Legend({ label, swatch }: { label: string; swatch: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className={`h-3 w-3 rounded-sm border ${swatch}`} aria-hidden="true" />
      {label}
    </span>
  );
}

function seatClassName(
  status: "available" | "unavailable",
  accessible: boolean,
): string {
  const color = accessible
    ? "border-sky-300 bg-sky-300/25"
    : status === "available"
      ? "border-emerald-300 bg-emerald-300/25"
      : "border-neutral-700 bg-neutral-800";

  return `h-5 w-5 rounded-t-md border ${color}`;
}
