# HowManySeats?

A Next.js app for seeing estimated occupied and open seats at nearby Cineplex showtimes.

## What Is Included

- Next.js + Tailwind search UI
- Optional Google Maps address suggestions with a manual-input fallback
- One-to-three-day searches and multi-select theatre-format filtering
- Node.js/TypeScript API route
- CLI collector using live Cineplex showtime and preview seat occupancy data
- Seat classifier and confidence scoring
- Discovery, schema, and compliance notes

Live collection uses Cineplex's public site APIs:

- `GET /prod/cpx/theatrical/api/v1/showtimes`
- `GET /prod/ticketing/api/v1/theatre/{theatreId}/showtime/{showtimeId}/seat-layout`
- `GET /prod/ticketing/api/v1/theatre/{theatreId}/showtime/{showtimeId}/seat-availability?preview=true`

It does not call `reserve-seats`, `set-tickets`, payment, cart mutation, login, or checkout endpoints.

## Setup

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open http://localhost:3000.

To enable Google Maps address suggestions, add a browser-restricted Google Maps API key to
`NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`. Enable Maps JavaScript API and Places API (New) for that key.
Without it, the same field remains available as a normal address, postal-code, or city input.

## CLI

```bash
npm run collect -- --location="Ottawa" --date="2026-05-05" --radius=25
```

Example output:

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
    "ticket_url": "https://www.cineplex.com/en-Mobile/ticketing/preview?theatreId=7311&showtimeId=125435&dbox=False"
  }
]
```

## Live Data Notes

Seat status mapping:

- Layout seat type `Wheelchair` or `Companion` is counted in `accessibility_count`, not occupied.
- Preview availability `Available` is counted as available.
- Preview availability `Occupied` is counted as occupied estimate.
- Preview availability `Broken`, unavailable, blocked, or house-reserved-like values are counted as blocked.
- Unknown values are counted in `unknown_count`.
- Empty availability for a post-showtime response is treated as unknown, not available.

## Optional Schema

The original product plan includes Postgres persistence. The schema is kept in `db/migrations/001_init.sql`, but the current app runs directly from live Cineplex preview data and does not require Postgres or Redis.

## Acknowledgment

HowManySeats? was inspired by Riley Walz's [Empty Screenings](https://walzr.com/empty-screenings), which explores the same private-theatre idea.
