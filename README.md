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
- Direct links to each cinema's public purchase flow and seat-map preview
- Separate totals and occupied counts for standard, accessible, and companion
  seats

## How it works

The Next.js API routes resolve the search location and return showtimes in the
selected area. Cineplex and Landmark discovery run in parallel. The app
checks the relevant seat maps automatically in bounded batches, caches the
results, and applies filters locally. It repeats discovery only when the
location, radius, or dates change. If a provider or individual request is
temporarily unavailable, the app warns that results may be partial.

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

## Acknowledgment

Riley Walz's [Empty Screenings](https://walzr.com/empty-screenings) inspired
this project.
