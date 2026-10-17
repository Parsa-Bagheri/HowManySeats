# HowManySeats?

HowManySeats estimates occupied and open seats at nearby Cineplex and Landmark
Cinemas showtimes. Search by Canadian address, postal code, or city. You can
then filter the results, buy tickets through the cinema, or preview the seat
map.

The project is an independent, unofficial tool and is not affiliated with
Cineplex or Landmark Cinemas.

## Features

- Two visual themes with the same search and result functionality
- Optional Google Maps address suggestions with manual entry when Maps is not
  configured or unavailable
- Searches covering one to three consecutive days
- Radius options from 10 to 100 kilometers
- Movie-title suggestions based on nearby showtimes
- Experience filtering for formats such as IMAX, UltraAVX, Laser Ultra, VIP,
  D-BOX, ScreenX, Premiere, and 3D
- Filters for empty showtimes, five-or-fewer occupied seats, showtimes starting
  within two hours, non-VIP showtimes, and accessible seating
- Distance and start-time sorting
- Explicit seat refresh with advancing freshness labels and retained snapshots
  when a provider temporarily fails
- Direct links to each cinema's public purchase flow and seat-map preview
- Separate totals and occupied counts for standard, accessible, and companion
  seats
- Optional background Cineplex watches with browser favorites, timestamped
  history, freshness states, and inspectable provider failures

## How it works

The Next.js API routes resolve the search location and return showtimes in the
selected area. Cineplex and Landmark discovery run in parallel. The app
checks the relevant seat maps automatically in bounded batches, caches the
results, and applies filters locally. It repeats discovery only when the
location, radius, or dates change. If a provider or individual request is
temporarily unavailable, the app warns that results may be partial.

**Refresh seats** rechecks the currently authorized showtimes using the submitted
location, dates, and radius with the current result filters. Edits to those scope
fields stay staged until Search. Refresh retries failed seat checks and retains
previous successful snapshots with their original check times if a retry fails.
The first 500 eligible showtimes are authorized; only **Show more** extends that
window. Refresh never adds authorization or starts background polling.

The Cineplex client uses these read-only public-site `GET` endpoints:

```text
GET /prod/cpx/theatrical/api/v1/theatres
GET /prod/cpx/theatrical/api/v1/showtimes
GET /prod/ticketing/api/v1/theatre/{theatreId}/showtime/{showtimeId}/seat-layout
GET /prod/ticketing/api/v1/theatre/{theatreId}/showtime/{showtimeId}/seat-availability?preview=true
```

The visitor's browser gets Landmark showtimes and seat availability directly
from Landmark's public JSON APIs:

```text
GET https://movieapi.landmarkcinemas.com/movies/22/{cinemaId}
GET https://bookingapi.landmarkcinemas.com/api/Seating/GetSessionSeatData/{cinemaId}/{sessionId}
```

The client keeps movie payloads in a bounded 60-second cache. Both requests go
directly from the visitor to first-party JSON APIs. The app doesn't launch an
automated browser or use an HTML reader.

Landmark provides its seat preview inside the official booking page instead of
at a standalone URL. Both Landmark actions open that official page. Select
**Preview Seatmap** there to view the current seat layout.

## Seat estimates

The estimate comes from the current preview seat map:

- `Available` standard seats count as open.
- `Occupied`, `Sold`, `Held`, and `Reserved` standard seats count toward the
  occupied estimate.
- Wheelchair-accessible and companion seats have their own totals and occupied
  counts. They don't affect the standard-seat occupancy filters.
- The accessible-seating filter requires at least one open wheelchair space;
  an open companion seat alone doesn't satisfy it.
- Broken, house, and unknown seat statuses are excluded from the estimate.

Seat availability can change at any time. Treat the numbers as a snapshot, not
as a guarantee from either cinema provider.

## Local development

Requirements:

- Node.js 22.17 or later
- npm

Install dependencies, create a local environment file, and start the
development server:

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Environment variables

| Variable | Purpose |
| --- | --- |
| `CINEPLEX_APIM_SUBSCRIPTION_KEY` | Optional override for the public Cineplex site API key used by the server |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | Optional browser-restricted key for Google Maps address suggestions |

For Google address suggestions, enable the Maps JavaScript API and Places API
(New). Restrict the key to the app's allowed browser origins. Without the key,
the address field remains a standard manual-entry field.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the local Next.js development server |
| `npm run build` | Create an optimized production build |
| `npm start` | Run the production build |
| `npm test` | Run the Node.js test suite |
| `npm run typecheck` | Run strict TypeScript checks without emitting files |

## Project structure

```text
src/app/       Next.js pages, UI, styles, and API routes
src/lib/       Provider clients, search logic, geocoding, and seat scoring
```

Tests are colocated with the library modules as `*.test.ts` files.

## Background screening watches

Background watches are disabled unless a server backend is configured. They
do not change interactive search or Landmark's browser collection. A server
confirms Cineplex screening identifiers against its directory/showtimes,
refreshes every five minutes until the screening starts (at most 48 hours),
and retains 24 observations with separate accessibility and unknown counts.
Favorites live in the browser; removing one does not stop a shared refresh.

For a free local fixture demo in PowerShell, set these variables in each
terminal after `npm ci`:

```powershell
$env:WATCH_BACKEND='local'
$env:WATCH_MODE='fixture'
$env:WATCH_DB_PATH='.watch-data/watches.sqlite'
```

Run `npm run dev -- -p 4311`, `npm run watch:dispatcher`, and
`npm run watch:worker` in separate terminals. Start a second worker in another
terminal. Open [the local watch page](http://localhost:4311/watches) and choose
the fixture demo buttons. Fixtures make no cinema requests. Stop each process
with Ctrl+C. For a live local provider run, use `WATCH_MODE=live` and add watches
from ordinary Cineplex search results; the existing provider deadlines apply.

`npm run watch:verify` runs an isolated two-process replay, a real process crash
after storage, and expired-lease recovery. It writes measured results under
`docs/evidence`. `npm run watch:ops -- inspect` shows watches, freshness, queue
age, retries and dead letters. The [operations/design guide](docs/background-watches.md)
includes export, pause, cleanup, the five-minute demo, and the prepared AWS
deployment. The [evidence note](docs/watch-evidence.md) distinguishes local
verification from cloud deployment.

## Acknowledgment

Riley Walz's [Empty Screenings](https://walzr.com/empty-screenings) inspired
this project.
