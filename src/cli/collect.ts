import { CineplexClient } from "@/lib/cineplex-client";
import type { SearchResult } from "@/lib/types";

type Args = {
  theatre?: string;
  date?: string;
  movie?: string;
  location?: string;
  radius?: number;
};

const timeFormatter = new Intl.DateTimeFormat("en-CA", {
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const client = new CineplexClient();
  const results = await client.search({
    location: args.location ?? args.theatre ?? "Ottawa",
    date: args.date ?? new Date().toISOString().slice(0, 10),
    radiusKm: args.radius ?? 25,
    movieTitle: args.movie,
    maxFiveSold: false,
  });

  process.stdout.write(
    `${JSON.stringify(results.map(toCliResult), null, 2)}\n`,
  );
}

function parseArgs(argv: string[]): Args {
  const args: Args = {};

  for (const arg of argv) {
    const match = arg.match(/^--([^=]+)=(.*)$/);
    if (!match) {
      continue;
    }

    const [, key, rawValue] = match;
    const value = rawValue.replace(/^"|"$/g, "");

    switch (key) {
      case "theatre":
        args.theatre = value;
        break;
      case "date":
        args.date = value;
        break;
      case "movie":
        args.movie = value;
        break;
      case "location":
        args.location = value;
        break;
      case "radius":
        args.radius = Number(value);
        break;
    }
  }

  return args;
}

function toCliResult(result: SearchResult) {
  return {
    theatre: result.theatre.name,
    movie: result.showtime.movieTitle,
    time: timeFormatter.format(new Date(result.showtime.startsAt)),
    format: result.showtime.format,
    occupied_estimate: result.snapshot.occupiedEstimate,
    available_count: result.snapshot.availableCount,
    sellable_seats: result.snapshot.sellableSeats,
    blocked_count: result.snapshot.blockedCount,
    accessibility_count: result.snapshot.accessibilityCount,
    unknown_count: result.snapshot.unknownCount,
    confidence: result.snapshot.confidence,
    ticket_url: result.showtime.ticketUrl,
  };
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
