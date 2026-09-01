# Cineplex technical discovery report

Date: May 4, 2026

## Scope

This report records the prototype's current safe discovery boundary. The
prototype doesn't sign in, enter payment information, hold seats, bypass a
CAPTCHA or rate limit, or automate ticket purchases.

## Public flow observed

Cineplex's promotions page describes this public flow: select a theatre, date,
movie, and showtime, and then continue to ticketing. Cineplex might ask the
customer to sign in before buying a ticket.

Cineplex states that online booking provides advance seat selection. Its
accessibility page describes wheelchair spaces, companion accommodations,
closed captioning, described services, and sensory-friendly screenings. The
classifier excludes accessibility-related seats from the default occupied
estimate.

Sources:

- [Cineplex promotions](https://www.cineplex.com/promotions)
- [Cineplex accessibility](https://www.cineplex.com/theatres/accessibility)
- [Scotiabank Theatre Ottawa](https://www.cineplex.com/theatre/scotiabank-theatre-ottawa)

## Findings

### Showtimes without signing in

Cineplex's public site bundle calls this endpoint:

```text
GET https://apis.cineplex.com/prod/cpx/theatrical/api/v1/showtimes?language=en&locationId={theatreId}&date={date}
```

The response contains the theatre, movie, format, session,
`vistaSessionId`, `ticketingUrl`, `seatMapUrl`, and the `isSoldOut`,
`isInThePast`, and `isReservedSeating` fields.

### Seat maps without signing in

During the tested preview flow, Cineplex's public preview page calls these
read-only GET endpoints:

```text
GET https://apis.cineplex.com/prod/ticketing/api/v1/theatre/{theatreId}/showtime/{showtimeId}/seat-layout
GET https://apis.cineplex.com/prod/ticketing/api/v1/theatre/{theatreId}/showtime/{showtimeId}/seat-availability?preview=true
```

A read-only test without signing in returned layout and availability JSON.

### Temporary seat holds

The verified preview calls don't create a hold. They send GET requests and are
separate from the POST endpoint that Cineplex uses to reserve seats:

```text
POST /prod/ticketing/api/v1/theatre/{theatreId}/showtime/{showtimeId}/reserve-seats
```

The prototype doesn't call that endpoint.

### Public JSON endpoints

Public site bundles expose the theatrical showtime API and the ticketing
preview seat APIs. The prototype calls these Cineplex public site GET endpoints
and doesn't call MovieXchange directly.

### Seat status representation

The JSON response contains explicit statuses. The layout contains seat IDs,
labels, and types such as `Standard`, `Wheelchair`, and `Companion`. Preview
availability maps seat IDs to values observed as `Available`, `Occupied`, and
`Broken`.

### Differences across theatres and formats

The flow can differ by province, theatre, VIP offering, or event type. The data
model stores format, VIP, accessibility services, auditorium, theatre
amenities, and unknown statuses separately. This separation supports
independent calibration for each theatre and format.

## Live verification

A read-only verification on May 4, 2026, against Scotiabank Theatre Ottawa
returned these occupancy estimates:

- `499498`: 68 seats, 0 occupied, 68 available, and not post-showtime.
- `499490`: 84 seats, 12 occupied, 72 available, and not post-showtime.
- `499511`: 0 occupied seats out of 64 sellable seats, with 4 accessibility
  seats tracked separately.
- `496465`: 0 occupied seats out of 344 sellable seats, with 11 accessibility
  seats tracked separately.

## Compliance risks

- Seat-map inspection might create temporary holds in some ticketing systems.
- Cineplex might require sign-in before seat selection.
- Some statuses can mean sold, held, house-reserved, accessibility-only,
  blocked, or unavailable for the selected ticket type.
- Frequent refreshes can create unnecessary load.

## Implemented guardrails

- The app doesn't buy tickets.
- The app doesn't store Cineplex sign-in credentials.
- Seat inspection calls read-only preview GET endpoints.
- The app doesn't call `reserve-seats`, `set-tickets`, payment, or cart mutation
  endpoints.
- The classifier treats wheelchair and companion seats as accessibility
  ambiguity, not sold seats.
- The classifier doesn't count blocked, house-reserved, unavailable, aisle, or
  unknown seats as sold by default.
- The scheduler defaults to low concurrency, delayed requests, short retry
  windows, and no refresh after showtime starts.
