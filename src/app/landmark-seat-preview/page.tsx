import type { Metadata } from "next";
import Link from "next/link";
import { z } from "zod";
import { buildLandmarkPurchaseUrl } from "@/lib/landmark-client";
import { getLandmarkTheatre } from "@/lib/landmark-theatres";
import SeatMapClient from "./seat-map-client";

export const dynamic = "force-dynamic";

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

      <SeatMapClient
        cinemaId={theatre.providerTheatreId}
        sessionId={parsed.data.sessionId}
        timeZone={theatre.timeZone}
      />
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
