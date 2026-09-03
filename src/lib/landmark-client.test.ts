import assert from "node:assert/strict";
import test from "node:test";
import {
  buildLandmarkPurchaseUrl,
  extractLandmarkMovies,
  LandmarkClient,
  localDateTimeToIso,
  type LandmarkMovie,
} from "./landmark-client";
import { fetchLandmarkSeatPreview } from "./landmark-seats";
import { getLandmarkTheatre } from "./landmark-theatres";

const sourceOrigin = "https://source.landmark.test";
const waterloo = getLandmarkTheatre("200");
const brandon = getLandmarkTheatre("181");

if (!waterloo || !brandon) {
  throw new Error("A Landmark theatre fixture is missing.");
}

test("extracts Landmark movies from the embedded showtime payload", () => {
  const movies = [{ FilmId: 42, Sessions: [], Title: "Example Movie" }];
  const parsed = extractLandmarkMovies(showtimePage(movies));

  assert.deepEqual(parsed, movies);
  assert.throws(
    () => extractLandmarkMovies("<html>No showtimes</html>"),
    /did not include its showtime data/,
  );
});

test("builds only valid Landmark purchase links", () => {
  assert.equal(
    buildLandmarkPurchaseUrl({
      cinemaId: "200",
      externalSessionId: "181815",
      filmId: "126642",
      sessionId: "11567088",
    }),
    "https://www.landmarkcinemas.com/booking?cinemaId=200&filmId=126642&externalSessionId=181815&sessionId=11567088",
  );
  assert.equal(
    buildLandmarkPurchaseUrl({
      cinemaId: "200",
      externalSessionId: "not-an-id",
      filmId: "126642",
      sessionId: "11567088",
    }),
    undefined,
  );
});

test("maps Landmark sessions, formats, ticket links, and preview links", async (t) => {
  const originalFetch = globalThis.fetch;
  let pageRequests = 0;
  const movies: LandmarkMovie[] = [
    {
      FilmId: 126642,
      Title: "Example Movie",
      Sessions: [
        {
          NewDate: "2026-09-01",
          ExperienceTypes: [
            {
              Times: [
                {
                  CinemaId: 200,
                  Experience: [
                    { Name: "2D" },
                    { Name: "Recliner Seating" },
                    { Name: "Premiere Seats" },
                  ],
                  ExternalSessionId: "181815",
                  Scheduleid: "11567088",
                  Screen: "Screen 4",
                  SessionExpired: false,
                  SoldOut: false,
                  StartTime: "7:30 PM",
                },
                {
                  CinemaId: 200,
                  ExternalSessionId: "181816",
                  Scheduleid: "11567089",
                  SoldOut: true,
                  StartTime: "8:30 PM",
                },
                {
                  CinemaId: 200,
                  ExternalSessionId: "181817",
                  Scheduleid: "11567090",
                  SessionExpired: true,
                  StartTime: "9:30 PM",
                },
              ],
            },
          ],
        },
        {
          NewDate: "2026-09-02",
          ExperienceTypes: [],
        },
      ],
    },
  ];

  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (input) => {
    const url = String(input);

    if (url === `${sourceOrigin}/showtimes/waterloo`) {
      pageRequests += 1;
      return new Response(showtimePage(movies), {
        headers: { "Set-Cookie": "LandmarkSession=abc; Path=/; HttpOnly" },
      });
    }

    throw new Error(`Unexpected request: ${url}`);
  };

  const client = new LandmarkClient([sourceOrigin]);
  const showtimes = await client.getShowtimes(waterloo, "2026-09-01");
  const nextDay = await client.getShowtimes(waterloo, "2026-09-02");
  const candidates = await client.search({
    date: "2026-09-01",
    endDate: "2026-09-01",
    latitude: waterloo.latitude,
    location: "Waterloo",
    longitude: waterloo.longitude,
    radiusKm: 25,
  });

  assert.equal(pageRequests, 1);
  assert.equal(showtimes.length, 1);
  assert.deepEqual(nextDay, []);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0]?.snapshot, undefined);
  assert.equal(showtimes[0]?.id, "landmark-200-11567088");
  assert.equal(showtimes[0]?.providerShowtimeId, "11567088");
  assert.equal(showtimes[0]?.startsAt, "2026-09-01T23:30:00.000Z");
  assert.equal(showtimes[0]?.format, "Regular, Recliner, Premiere");
  assert.equal(showtimes[0]?.auditorium, "Screen 4");
  assert.equal(
    showtimes[0]?.purchaseUrl,
    "https://www.landmarkcinemas.com/booking?cinemaId=200&filmId=126642&externalSessionId=181815&sessionId=11567088",
  );

  const previewUrl = new URL(
    showtimes[0]?.seatPreviewUrl ?? "",
    "https://howmanyseats.test",
  );
  assert.equal(previewUrl.pathname, "/landmark-seat-preview");
  assert.equal(previewUrl.searchParams.get("cinemaId"), "200");
  assert.equal(previewUrl.searchParams.get("filmId"), "126642");
  assert.equal(previewUrl.searchParams.get("sessionId"), "11567088");
});

test("gets Landmark booking API data and normalizes its seat map", async (t) => {
  const originalFetch = globalThis.fetch;
  let seatRequest: { headers: Headers; method?: string } | undefined;

  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (input, init) => {
    const url = String(input);

    if (
      url ===
      "https://bookingapi.landmarkcinemas.com/api/Seating/GetSessionSeatData/200/11567088"
    ) {
      seatRequest = {
        headers: new Headers(init?.headers),
        method: init?.method,
      };
      return Response.json({
        Area: {
          Rows: [
            {
              Seats: [
                { Column: 1, Row: "A", SeatId: "A1", SeatName: "A-1", Type: 1 },
                { Column: 2, Row: "A", SeatId: "A2", SeatName: "A-2", Status: 1, Type: 1 },
                { Column: 3, Row: "A", SeatId: "WC1", SeatName: "A-WC1", Type: 2 },
                { Column: 4, Row: "A", SeatId: "C1", SeatName: "A-4", Style: 4, Type: 1 },
              ],
            },
          ],
        },
      });
    }

    throw new Error(`Unexpected request: ${url}`);
  };

  const preview = await fetchLandmarkSeatPreview("200", "11567088");

  assert.equal(seatRequest?.method, undefined);
  assert.equal(seatRequest?.headers.get("accept"), "application/json");
  assert.equal(preview.snapshot.sellableSeats, 2);
  assert.equal(preview.snapshot.occupiedEstimate, 1);
  assert.equal(preview.snapshot.accessibilityCount, 2);
  assert.equal(preview.rows[0]?.seats.length, 4);
  assert.equal(preview.rows[0]?.seats[0]?.status, "available");
});

test("uses the plain HTTP reader and shares its short-lived page cache", async (t) => {
  const originalFetch = globalThis.fetch;
  let readerHeaders: Headers | undefined;
  let readerRequests = 0;
  const seatRequests: string[] = [];
  const movies: LandmarkMovie[] = [
    {
      FilmId: 126642,
      Sessions: [
        {
          ExperienceTypes: [
            {
              Times: [
                {
                  CinemaId: 200,
                  ExternalSessionId: "181815",
                  Scheduleid: "11567088",
                  StartTime: "7:30 PM",
                },
              ],
            },
          ],
          NewDate: "2026-09-01",
        },
      ],
      Title: "Example Movie",
    },
  ];

  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (input, init) => {
    const url = String(input);

    if (
      url ===
      "https://r.jina.ai/https://www.landmarkcinemas.com/showtimes/waterloo"
    ) {
      readerRequests += 1;
      readerHeaders = new Headers(init?.headers);
      return new Response(showtimePage(movies));
    }

    if (
      url ===
      "https://bookingapi.landmarkcinemas.com/api/Seating/GetSessionSeatData/200/11567088"
    ) {
      seatRequests.push(url);
      return Response.json({
        Seats: [
          {
            Column: 1,
            Row: 1,
            SeatId: "A1",
            SeatName: "A-1",
            Type: 1,
          },
        ],
      });
    }

    throw new Error(`Unexpected request: ${url}`);
  };

  const firstClient = new LandmarkClient();
  const secondClient = new LandmarkClient();
  const firstShowtimes = await firstClient.getShowtimes(
    waterloo,
    "2026-09-01",
  );
  const secondShowtimes = await secondClient.getShowtimes(
    waterloo,
    "2026-09-01",
  );
  const preview = await fetchLandmarkSeatPreview("200", "11567088");

  assert.equal(readerRequests, 1);
  assert.equal(readerHeaders?.get("x-engine"), "direct");
  assert.equal(readerHeaders?.get("x-respond-with"), "html");
  assert.equal(readerHeaders?.get("x-cache-tolerance"), "60");
  assert.equal(firstShowtimes.length, 1);
  assert.equal(secondShowtimes.length, 1);
  assert.equal(preview.snapshot.sellableSeats, 1);
  assert.deepEqual(seatRequests, [
    "https://bookingapi.landmarkcinemas.com/api/Seating/GetSessionSeatData/200/11567088",
  ]);
});

test("fails clearly when every plain HTTP source is blocked", async (t) => {
  const originalFetch = globalThis.fetch;
  const requests: string[] = [];

  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (input) => {
    requests.push(String(input));
    return new Response("Access denied", { status: 403 });
  };

  await assert.rejects(
    new LandmarkClient([sourceOrigin]).getShowtimes(brandon, "2026-09-01"),
    /Landmark showtimes are unavailable for Brandon/,
  );
  assert.deepEqual(requests.sort(), [
    "https://r.jina.ai/https://www.landmarkcinemas.com/showtimes/brandon",
    `${sourceOrigin}/showtimes/brandon`,
  ]);
});

test("converts Landmark local showtimes with daylight-saving offsets", () => {
  assert.equal(
    localDateTimeToIso("2026-09-01", "7:30 PM", "America/Toronto"),
    "2026-09-01T23:30:00.000Z",
  );
  assert.equal(
    localDateTimeToIso("2026-12-01", "7:30 PM", "America/Toronto"),
    "2026-12-02T00:30:00.000Z",
  );
});

function showtimePage(movies: LandmarkMovie[]): string {
  return `<!doctype html>
    <input id="AntiForgeryToken" value="token&amp;part">
    <script>
      var pc = pc || {};
      pc.showtimesdata = {
        'nowbooking': {
          '0': ${JSON.stringify(movies)}
        }
      };
    </script>`;
}
