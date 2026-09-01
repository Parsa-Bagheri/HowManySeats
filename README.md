# HowManySeats?

HowManySeats estimates occupied and open seats at nearby Cineplex showtimes.
Search by Canadian address, postal code, or city; narrow the results; then open
Cineplex to buy tickets or preview the seat map.

The project is an independent, unofficial tool and is not affiliated with
Cineplex.

## Features

- Two visual themes with the same search and result functionality
- Optional Google Maps address suggestions with manual entry when Maps is not
  configured or unavailable
- Searches covering one to three consecutive days
- Radius options from 10 to 100 kilometres
- Movie-title suggestions based on nearby showtimes
- Theatre-type filtering for formats such as IMAX, UltraAVX, VIP, D-BOX, 4DX,
  ScreenX, and 3D
- Filters for empty showtimes, five-or-fewer occupied seats, showtimes starting
  within two hours, non-VIP showtimes, and accessible seating
- Distance and start-time sorting
- Direct links to Cineplex's public purchase flow and seat-map preview
- Separate tracking for available, occupied, blocked, accessible, and unknown
  seats

## How it works

The Next.js API routes resolve the search location, find nearby Cineplex
theatres, fetch their showtimes, and inspect a bounded number of seat maps. The
app uses read-only Cineplex public-site GET endpoints:

```text
GET /prod/cpx/theatrical/api/v1/theatres
GET /prod/cpx/theatrical/api/v1/showtimes
GET /prod/ticketing/api/v1/theatre/{theatreId}/showtime/{showtimeId}/seat-layout
GET /prod/ticketing/api/v1/theatre/{theatreId}/showtime/{showtimeId}/seat-availability?preview=true
```

It does not call seat-reservation, ticket-selection, cart, payment, sign-in, or
checkout endpoints.

## Seat estimates

The estimate is derived from the current preview seat map:

- `Available` standard seats count as open.
- `Occupied` and held standard seats count toward the occupied estimate.
- Broken, blocked, unavailable, and house-reserved seats are tracked as
  blocked rather than occupied.
- Wheelchair and companion seats are tracked separately as accessible seats.
- Unrecognized and post-showtime values are tracked as unknown.

Seat availability can change at any time. Treat the numbers as a snapshot, not
as a guarantee from Cineplex.

## Local development

Requirements:

- A current Node.js LTS release
- npm

Install dependencies and create a local environment file from `.env.example`:

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
| `CINEPLEX_MAX_THEATRES_PER_SEARCH` | Maximum nearby theatres inspected per search; defaults to `5` |
| `CINEPLEX_MAX_SEAT_CHECKS_PER_SEARCH` | Maximum showtime seat maps inspected per search; defaults to `40` |
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
src/lib/       Cineplex client, search logic, geocoding, and seat scoring
docs/          Technical discovery and compliance notes
```

Tests are colocated with the library modules as `*.test.ts` files.

## Acknowledgment

Riley Walz's [Empty Screenings](https://walzr.com/empty-screenings) inspired
this project.
