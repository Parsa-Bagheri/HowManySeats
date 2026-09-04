import assert from "node:assert/strict";
import test from "node:test";
import {
  buildLandmarkPurchaseUrl,
  LandmarkClient,
  parseLandmarkMovies,
  type LandmarkMovie,
} from "./landmark-client";
import {
  buildLandmarkSeatSnapshot,
  fetchLandmarkSeatSnapshot,
} from "./landmark-seats";
import { getLandmarkTheatre } from "./landmark-theatres";
import { localDateTimeToIso } from "./showtime-time";

const sourceOrigin = "https://source.landmark.test";
const waterloo = getLandmarkTheatre("200");
const brandon = getLandmarkTheatre("181");

if (!waterloo || !brandon) {
  throw new Error("A Landmark theatre fixture is missing.");
}

test("validates Landmark movie API payloads", () => {
  const movies = [{ FilmId: 42, Sessions: [], Title: "Example Movie" }];
  const parsed = parseLandmarkMovies(movies);

  assert.deepEqual(parsed, movies);
  assert.throws(
    () => parseLandmarkMovies({ movies }),
    /invalid movie data/,
  );
  assert.throws(() => parseLandmarkMovies([null]), /invalid movie data/);
  assert.throws(() => parseLandmarkMovies([{}]), /invalid movie data/);
  assert.throws(
    () =>
      parseLandmarkMovies([
        { FilmId: 42, Sessions: {}, Title: "Example Movie" },
      ]),
    /invalid movie data/,
  );
  assert.throws(
    () =>
      parseLandmarkMovies([
        {
          FilmId: 42,
          Sessions: [
            { NewDate: "2026-09-01", Times: [null] },
          ],
          Title: "Example Movie",
        },
      ]),
    /invalid movie data/,
  );
  assert.throws(
    () =>
      parseLandmarkMovies([
        {
          FilmId: 42,
          Sessions: [
            {
              NewDate: "2026-09-01",
              Times: [{ StartTime: 1930 }],
            },
          ],
          Title: "Example Movie",
        },
      ]),
    /invalid movie data/,
  );
  assert.throws(
    () =>
      parseLandmarkMovies([
        {
          FilmId: 42,
          Sessions: [
            {
              NewDate: "2026-09-01",
              Times: [{ Experience: [{ Name: 2 }] }],
            },
          ],
          Title: "Example Movie",
        },
      ]),
    /invalid movie data/,
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
              ExternalSessionId: "181814",
              Scheduleid: "11567087",
              StartTime: "3:00 PM",
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
        {
          NewDate: "2026-09-02",
          Times: [],
        },
      ],
    },
  ];

  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (input) => {
    const url = String(input);

    if (url === `${sourceOrigin}/movies/22/200`) {
      pageRequests += 1;
      return Response.json(movies);
    }

    throw new Error(`Unexpected request: ${url}`);
  };

  const client = new LandmarkClient(
    sourceOrigin,
    () => new Date("2026-09-01T20:00:00.000Z"),
  );
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
  const suggestions = await client.suggestMovieTitles({
    date: "2026-09-01",
    latitude: waterloo.latitude,
    location: "Waterloo",
    longitude: waterloo.longitude,
    movieTitle: "example",
    radiusKm: 25,
  });

  assert.equal(pageRequests, 1);
  assert.equal(showtimes.length, 2);
  assert.deepEqual(nextDay, []);
  assert.equal(candidates.length, 1);
  assert.equal(suggestions[0]?.showtimeCount, 1);
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

  assert.equal(showtimes[0]?.seatPreviewUrl, showtimes[0]?.purchaseUrl);
  assert.match(
    showtimes[0]?.seatPreviewUrl ?? "",
    /^https:\/\/www\.landmarkcinemas\.com\/booking\?/,
  );
});

test("does not truncate Landmark showtime candidates at 40", async (t) => {
  const originalFetch = globalThis.fetch;
  const apiOrigin = "https://uncapped-movie-api.landmark.test";
  const movies: LandmarkMovie[] = [
    {
      FilmId: 126642,
      Sessions: [
        {
          Times: Array.from({ length: 45 }, (_, index) => ({
            CinemaId: 200,
            ExternalSessionId: 181000 + index,
            Scheduleid: 11500000 + index,
            StartTime: "7:30 PM",
          })),
          NewDate: "2026-09-01",
        },
      ],
      Title: "Example Movie",
    },
  ];

  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (input) => {
    if (String(input) === `${apiOrigin}/movies/22/200`) {
      return Response.json(movies);
    }

    throw new Error(`Unexpected request: ${String(input)}`);
  };

  const results = await new LandmarkClient(
    apiOrigin,
    () => new Date("2026-09-01T12:00:00.000Z"),
  ).search({
    date: "2026-09-01",
    latitude: waterloo.latitude,
    location: "Waterloo",
    longitude: waterloo.longitude,
    radiusKm: 25,
  });

  assert.equal(results.length, 45);
});

test("requests showtimes from Landmark's official movie API", async (t) => {
  const originalFetch = globalThis.fetch;
  const requests: string[] = [];
  let apiHeaders: Headers | undefined;
  const apiOrigin = "https://movie-api.landmark.test";

  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    requests.push(url);

    if (url === `${apiOrigin}/movies/22/200`) {
      apiHeaders = new Headers(init?.headers);
      return Response.json([]);
    }

    throw new Error(`Blocked request: ${url}`);
  };

  const showtimes = await new LandmarkClient(apiOrigin).getShowtimes(
    waterloo,
    "2026-09-01",
  );

  assert.deepEqual(showtimes, []);
  assert.deepEqual(requests, [`${apiOrigin}/movies/22/200`]);
  assert.equal(apiHeaders?.get("accept"), "application/json");
  assert.match(apiHeaders?.get("user-agent") ?? "", /^Mozilla\/5\.0/);
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
                { Column: 5, Row: "A", SeatId: "A5", SeatName: "A-5", Status: 2, Type: 1 },
                { Column: 6, Row: "A", SeatId: "A6", SeatName: "A-6", Status: 3, Type: 1 },
              ],
            },
          ],
        },
      });
    }

    throw new Error(`Unexpected request: ${url}`);
  };

  const snapshot = await fetchLandmarkSeatSnapshot("200", "11567088");

  assert.equal(seatRequest?.method, undefined);
  assert.equal(seatRequest?.headers.get("accept"), "application/json");
  assert.equal(snapshot.sellableSeats, 2);
  assert.equal(snapshot.occupiedEstimate, 1);
  assert.equal(snapshot.accessibilityCount, 2);
});

test("counts repeated Landmark seat IDs by their auditorium position", async (t) => {
  const originalFetch = globalThis.fetch;
  const rowFixtures: Array<{
    label: string;
    seatCount: number;
    occupiedColumns: number[];
    wheelchairColumns: number[];
    companionColumns: number[];
  }> = [
    {
      label: "A",
      seatCount: 12,
      occupiedColumns: [],
      wheelchairColumns: [],
      companionColumns: [],
    },
    {
      label: "B",
      seatCount: 9,
      occupiedColumns: [],
      wheelchairColumns: [3, 6, 7],
      companionColumns: [2, 5, 8],
    },
    {
      label: "C",
      seatCount: 7,
      occupiedColumns: [1, 2],
      wheelchairColumns: [],
      companionColumns: [],
    },
    {
      label: "D",
      seatCount: 7,
      occupiedColumns: [1, 2, 3, 4, 5, 6, 7],
      wheelchairColumns: [],
      companionColumns: [],
    },
    {
      label: "E",
      seatCount: 10,
      occupiedColumns: [1, 2, 3, 4],
      wheelchairColumns: [],
      companionColumns: [],
    },
    {
      label: "F",
      seatCount: 13,
      occupiedColumns: [],
      wheelchairColumns: [],
      companionColumns: [],
    },
  ];
  let wheelchairSeatId = 1;

  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async () =>
    Response.json({
      SeatLayoutData: {
        Areas: rowFixtures.map((row, rowIndex) => ({
          Rows: [
            {
              PhysicalName: row.label,
              Seats: Array.from({ length: row.seatCount }, (_, index) => {
                const column = index + 1;
                const wheelchair = row.wheelchairColumns.includes(column);
                const groupedColumns = [
                  [2, 3],
                  [5, 6],
                  [8, 7],
                ].find(
                  (pair) =>
                    row.label === "B" &&
                    pair.includes(column) &&
                    (wheelchair || row.companionColumns.includes(column)),
                );
                const areaId = rowIndex + 1;

                return {
                  AreaCategoryCode: "0001",
                  AreaId: areaId,
                  Column: column,
                  Row: 0,
                  SeatId: wheelchair ? `WC${wheelchairSeatId++}` : column,
                  SeatsInGroup: groupedColumns
                    ? Object.fromEntries(
                        groupedColumns.map((groupColumn) => [
                          groupColumn,
                          {
                            AreaNumber: areaId,
                            ColumnIndex: groupColumn,
                            RowIndex: 0,
                          },
                        ]),
                      )
                    : undefined,
                  Status:
                    row.label === "A" && column === 1
                      ? 5
                      : row.occupiedColumns.includes(column)
                        ? 1
                        : 0,
                  Style: 0,
                  Type: wheelchair ? 2 : 1,
                };
              }),
            },
          ],
        })),
      },
    });

  const snapshot = await fetchLandmarkSeatSnapshot("180", "11569889");

  assert.equal(snapshot.sellableSeats, 51);
  assert.equal(snapshot.occupiedEstimate, 13);
  assert.equal(
    snapshot.sellableSeats - snapshot.occupiedEstimate,
    38,
  );
  assert.equal(snapshot.accessibilityCount, 6);
});

test("reads canonical Vista seat positions", async (t) => {
  const originalFetch = globalThis.fetch;

  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async () =>
    Response.json({
      SeatLayoutData: {
        Areas: [
          {
            AreaCategoryCode: "0001",
            Rows: [
              {
                PhysicalName: "A",
                Seats: [
                  {
                    Id: "1",
                    Position: {
                      AreaNumber: 1,
                      ColumnIndex: 1,
                      RowIndex: 0,
                    },
                    SeatStyle: 1,
                    Status: 0,
                  },
                  {
                    Id: "2",
                    Position: {
                      AreaNumber: 1,
                      ColumnIndex: 2,
                      RowIndex: 0,
                    },
                    SeatStyle: 1,
                    Status: 1,
                  },
                ],
              },
            ],
          },
        ],
      },
    });

  const snapshot = await fetchLandmarkSeatSnapshot("180", "11569889");

  assert.equal(snapshot.sellableSeats, 2);
  assert.equal(snapshot.occupiedEstimate, 1);
});

test("uses Vista seat availability and accessibility values", () => {
  const snapshot = buildLandmarkSeatSnapshot({
    SeatLayoutData: {
      Areas: [
        {
          Rows: [
            {
              Seats: [
                seatFixture("available", 1, 0),
                seatFixture("sold", 2, 1),
                seatFixture("broken", 3, 2),
                seatFixture("house", 4, 3),
                seatFixture("reserved", 5, 4),
                seatFixture("unknown", 6, 5),
                { ...seatFixture("wheelchair", 7, 0), SeatStyle: 3 },
                { ...seatFixture("companion", 8, 0), SeatStyle: 7 },
                {
                  ...seatFixture("reserved-wheelchair", 9, 4),
                  OriginalStatus: 3,
                },
                {
                  ...seatFixture("reserved-companion", 10, 4),
                  OriginalStatus: 7,
                },
              ],
            },
          ],
        },
      ],
    },
  });

  assert.equal(snapshot.sellableSeats, 3);
  assert.equal(snapshot.occupiedEstimate, 2);
  assert.equal(snapshot.accessibilityCount, 4);
});

test("shares the official movie API's short-lived cache", async (t) => {
  const originalFetch = globalThis.fetch;
  const apiOrigin = "https://cached-movie-api.landmark.test";
  let apiHeaders: Headers | undefined;
  let apiRequests = 0;
  const seatRequests: string[] = [];
  const movies: LandmarkMovie[] = [
    {
      FilmId: 126642,
      Sessions: [
        {
          Times: [
            {
              CinemaId: 200,
              ExternalSessionId: "181815",
              Scheduleid: "11567088",
              StartTime: "7:30 PM",
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

    if (url === `${apiOrigin}/movies/22/200`) {
      apiRequests += 1;
      apiHeaders = new Headers(init?.headers);
      return Response.json(movies);
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

  const firstClient = new LandmarkClient(apiOrigin);
  const secondClient = new LandmarkClient(apiOrigin);
  const firstShowtimes = await firstClient.getShowtimes(
    waterloo,
    "2026-09-01",
  );
  const secondShowtimes = await secondClient.getShowtimes(
    waterloo,
    "2026-09-01",
  );
  const snapshot = await fetchLandmarkSeatSnapshot("200", "11567088");

  assert.equal(apiRequests, 1);
  assert.equal(apiHeaders?.get("accept"), "application/json");
  assert.equal(firstShowtimes.length, 1);
  assert.equal(secondShowtimes.length, 1);
  assert.equal(snapshot.sellableSeats, 1);
  assert.deepEqual(seatRequests, [
    "https://bookingapi.landmarkcinemas.com/api/Seating/GetSessionSeatData/200/11567088",
  ]);
});

test("fails clearly when the official movie API is blocked", async (t) => {
  const originalFetch = globalThis.fetch;
  const requests: string[] = [];
  const apiOrigin = "https://blocked-movie-api.landmark.test";

  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (input) => {
    requests.push(String(input));
    return new Response("Access denied", { status: 403 });
  };

  await assert.rejects(
    new LandmarkClient(apiOrigin).getShowtimes(brandon, "2026-09-01"),
    /Landmark movie API failed with HTTP 403/,
  );
  assert.deepEqual(requests, [`${apiOrigin}/movies/22/181`]);
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

function seatFixture(id: string, column: number, status: number) {
  return {
    Id: id,
    Position: { AreaNumber: 1, ColumnIndex: column, RowIndex: 0 },
    Status: status,
  };
}
