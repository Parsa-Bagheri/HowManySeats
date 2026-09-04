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
- Counts for sellable, occupied, and accessible seats

## How it works

The Next.js API routes resolve the search location and return every matching
showtime from the nearby theaters. Cineplex and Landmark discovery run in
parallel. The app checks seat maps in bounded batches and lets the visitor check
more showtimes without repeating the discovery request. If one provider is
temporarily unavailable, the app shows a warning and returns results from the
other provider.

The Cineplex client uses these read-only public-site `GET` endpoints:

```text
GET /prod/cpx/theatrical/api/v1/theatres
GET /prod/cpx/theatrical/api/v1/showtimes
GET /prod/ticketing/api/v1/theatre/{theatreId}/showtime/{showtimeId}/seat-layout
GET /prod/ticketing/api/v1/theatre/{theatreId}/showtime/{showtimeId}/seat-availability?preview=true
```

The Landmark client gets the complete movie and session payload from Landmark's
public movie API. After the server returns matching showtimes, the visitor's
browser gets seat availability from Landmark's public booking API:

```text
GET https://movieapi.landmarkcinemas.com/movies/22/{cinemaId}
GET https://bookingapi.landmarkcinemas.com/api/Seating/GetSessionSeatData/{cinemaId}/{sessionId}
```

The client keeps movie payloads in a bounded 60-second cache. Seat-map requests
go directly from the visitor to the first-party JSON API. The app doesn't launch
an automated browser or use an HTML reader.

Landmark provides its seat preview inside the official booking page instead of
at a standalone URL. Both Landmark actions open that official page. Select
**Preview Seatmap** there to view the current seat layout.

## Seat estimates

The estimate comes from the current preview seat map:

- `Available` standard seats count as open.
- `Occupied`, `Sold`, `Held`, and `Reserved` standard seats count toward the
  occupied estimate.
- Wheelchair and companion seats count as accessible seats. Broken, house, and
  unknown seat statuses are excluded from the estimate.

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
| `CINEPLEX_MAX_THEATRES_PER_SEARCH` | Maximum nearby theaters inspected per search; defaults to `5` |
| `LANDMARK_MOVIE_CACHE_SECONDS` | Maximum age for cached Landmark movie payloads; defaults to `60` and is capped at `300` |
| `LANDMARK_MAX_THEATRES_PER_SEARCH` | Maximum nearby Landmark theaters inspected per search; defaults to `5` |
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
