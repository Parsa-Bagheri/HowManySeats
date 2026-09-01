# HowManySeats?

The app estimates occupied and open seats at nearby Cineplex showtimes.

## What's included

- Next.js and Tailwind CSS search interface
- Optional Google Maps address suggestions with a manual-entry fallback
- Search ranges of up to three days
- A multiselect theatre-format filter
- A Node.js API route written in TypeScript
- A command-line interface (CLI) collector that uses live Cineplex showtime and
  preview seat-occupancy data
- Seat classification and confidence scoring
- Discovery, schema, and compliance notes

The app uses these Cineplex public site APIs:

- `GET /prod/cpx/theatrical/api/v1/showtimes`
- `GET /prod/ticketing/api/v1/theatre/{theatreId}/showtime/{showtimeId}/seat-layout`
- `GET /prod/ticketing/api/v1/theatre/{theatreId}/showtime/{showtimeId}/seat-availability?preview=true`

The app doesn't call `reserve-seats`, `set-tickets`, payment, cart mutation,
sign-in, or checkout endpoints.

## Set up

Run these commands:

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open the [local app](http://localhost:3000).

To enable Google Maps address suggestions:

1. Add a browser-restricted Google Maps API key to
   `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`.
2. Enable the Maps JavaScript API and Places API (New) for the key.

If you don't add a key, the field continues to accept a manually entered
address, postal code, or city.

## Use the command-line collector

Run the collector with a location, date, and radius:

```bash
npm run collect -- --location="Ottawa" --date="2026-05-05" --radius=25
```

The command returns output like this:

```json
[
  {
    "theatre": "Scotiabank Theatre Ottawa",
    "movie": "Example Movie",
    "time": "21:20",
    "format": "Recliner",
    "occupied_estimate": 0,
    "available_count": 64,
    "sellable_seats": 64,
    "blocked_count": 0,
    "accessibility_count": 4,
    "unknown_count": 0,
    "confidence": "high",
    "ticket_url": "https://www.cineplex.com/en-Mobile/ticketing/preview"
  }
]
```

## Live data notes

The app maps seat statuses as follows:

- Layout types `Wheelchair` and `Companion` increment `accessibility_count`,
  not the occupied estimate.
- Preview value `Available` increments `available_count`.
- Preview value `Occupied` increments the occupied estimate.
- Values such as `Broken`, unavailable, blocked, or house-reserved increment
  `blocked_count`.
- Unrecognized values increment `unknown_count`.
- A post-showtime response with no availability increments `unknown_count`
  instead of `available_count`.

## Optional schema

The initial product plan includes PostgreSQL persistence. The current app reads
live Cineplex preview data and doesn't require PostgreSQL or Redis. The optional
schema is in `db/migrations/001_init.sql`.

## Acknowledgment

Riley Walz's [Empty Screenings](https://walzr.com/empty-screenings) inspired
this project. It explores the same private-theatre idea.
