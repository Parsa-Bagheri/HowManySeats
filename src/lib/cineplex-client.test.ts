import assert from "node:assert/strict";
import test from "node:test";
import {
  CineplexClient,
  normalizePublicPurchaseUrl,
} from "./cineplex-client";

test("accepts Cineplex public purchase deeplinks", () => {
  const url =
    "https://apis.cineplex.com/prod/cpx/theatrical/deeplink?s=454782&a=0000000004&l=7402&m=example-movie&ss=False";

  assert.equal(normalizePublicPurchaseUrl(url), url);
});

test("rejects incomplete or non-Cineplex purchase links", () => {
  assert.equal(
    normalizePublicPurchaseUrl(
      "https://apis.cineplex.com/prod/cpx/theatrical/deeplink?s=454782&l=7402&m=example-movie",
    ),
    undefined,
  );
  assert.equal(
    normalizePublicPurchaseUrl(
      "https://example.com/prod/cpx/theatrical/deeplink?s=454782&a=4&l=7402&m=example-movie",
    ),
    undefined,
  );
  assert.equal(normalizePublicPurchaseUrl("not a URL"), undefined);
});

test("maps purchase and preview links from Cineplex showtimes", async (t) => {
  const originalFetch = globalThis.fetch;
  const purchaseUrl =
    "https://apis.cineplex.com/prod/cpx/theatrical/deeplink?s=454782&a=0000000004&l=7402&m=example-movie&ss=False";
  const seatPreviewUrl =
    "https://www.cineplex.com/en-Mobile/ticketing/preview?theatreId=7402&showtimeId=454782&dbox=False";

  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify([
        {
          dates: [
            {
              movies: [
                {
                  name: "Example Movie",
                  experiences: [
                    {
                      experienceTypes: ["IMAX"],
                      sessions: [
                        {
                          vistaSessionId: 454782,
                          showStartDateTime: "2026-08-31T19:00:00",
                          deeplinkUrl: purchaseUrl,
                          seatMapUrl: seatPreviewUrl,
                          isShowtimeEnabledOnline: true,
                          isReservedSeating: true,
                        },
                        {
                          vistaSessionId: 454783,
                          showStartDateTime: "2026-08-31T22:00:00",
                          deeplinkUrl: purchaseUrl,
                          isShowtimeEnabledOnline: false,
                          isReservedSeating: true,
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ]),
      { status: 200 },
    );

  const client = new CineplexClient("test-key");
  const showtimes = await client.getShowtimes(
    {
      id: "cineplex-7402",
      provider: "cineplex",
      providerTheatreId: "7402",
      name: "Example Theatre",
      city: "Example City",
      province: "ON",
      timeZone: "America/Toronto",
    },
    "2026-08-31",
  );

  assert.equal(showtimes[0]?.purchaseUrl, purchaseUrl);
  assert.equal(showtimes[0]?.startsAt, "2026-08-31T23:00:00.000Z");
  assert.equal(showtimes[0]?.seatPreviewUrl, seatPreviewUrl);
  assert.equal(showtimes[1]?.purchaseUrl, undefined);
  assert.equal(
    showtimes[1]?.seatPreviewUrl,
    "https://www.cineplex.com/en-Mobile/ticketing/preview?theatreId=7402&showtimeId=454783&dbox=False",
  );
});

test("treats an empty showtime response as no showtimes", async (t) => {
  const originalFetch = globalThis.fetch;

  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async () => new Response("");

  const client = new CineplexClient("test-key");
  const showtimes = await client.getShowtimes(
    {
      id: "cineplex-7402",
      provider: "cineplex",
      providerTheatreId: "7402",
      name: "Example Theatre",
      city: "Example City",
      province: "ON",
    },
    "2026-09-01",
  );

  assert.deepEqual(showtimes, []);
});

test("checks seat maps in bounded parallel batches", async (t) => {
  const originalFetch = globalThis.fetch;
  let activeSeatRequests = 0;
  let peakSeatRequests = 0;

  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (input) => {
    const url = String(input);

    if (url.includes("/v1/theatres?")) {
      return Response.json({
        nearbyTheatres: [
          {
            theatreId: 7402,
            theatreName: "Example Theatre",
            location: {
              city: "Toronto",
              provinceCode: "ON",
              geoLocation: { latitude: 43.65, longitude: -79.38 },
            },
          },
        ],
      });
    }

    if (url.includes("/v1/showtimes?")) {
      return Response.json([
        {
          dates: [
            {
              movies: [
                {
                  name: "Example Movie",
                  experiences: [
                    {
                      experienceTypes: ["Regular"],
                      sessions: [
                        {
                          vistaSessionId: 999,
                          showStartDateTime: "2026-09-01T07:00:00",
                          isReservedSeating: true,
                        },
                        ...Array.from({ length: 5 }, (_, index) => ({
                          vistaSessionId: 1000 + index,
                          showStartDateTime: `2026-09-01T${10 + index}:00:00`,
                          isReservedSeating: true,
                        })),
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ]);
    }

    if (url.includes("/seat-layout") || url.includes("/seat-availability")) {
      activeSeatRequests += 1;
      peakSeatRequests = Math.max(peakSeatRequests, activeSeatRequests);
      await new Promise((resolve) => setTimeout(resolve, 5));
      activeSeatRequests -= 1;

      return url.includes("/seat-layout")
        ? Response.json({
            standardSeats: {
              rows: [{ seats: [{ id: "A1", type: "Standard" }] }],
            },
          })
        : Response.json({ seatAvailabilities: { A1: "Available" } });
    }

    throw new Error(`Unexpected request: ${url}`);
  };

  const client = new CineplexClient(
    "test-key",
    () => new Date("2026-09-01T12:00:00.000Z"),
  );
  const results = await client.search({
    location: "Toronto",
    date: "2026-09-01",
    endDate: "2026-09-02",
    radiusKm: 25,
    latitude: 43.65,
    longitude: -79.38,
  });
  const snapshots = await client.getSeatSnapshots(
    results.map((result) => ({
      resultId: result.showtime.id,
      showtimeId: result.showtime.providerShowtimeId,
      theatreId: result.theatre.providerTheatreId,
    })),
  );
  const suggestions = await client.suggestMovieTitles({
    date: "2026-09-01",
    endDate: "2026-09-02",
    latitude: 43.65,
    location: "Toronto",
    longitude: -79.38,
    movieTitle: "example",
    radiusKm: 25,
  });

  assert.equal(results.length, 5);
  assert.equal(results[0]?.snapshot, undefined);
  assert.equal(snapshots.results.length, 5);
  assert.deepEqual(snapshots.failedResultIds, []);
  assert.equal(suggestions[0]?.showtimeCount, 5);
  assert.equal(peakSeatRequests, 10);
});

test("does not truncate showtime candidates at 40", async (t) => {
  const originalFetch = globalThis.fetch;
  let seatRequests = 0;

  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (input) => {
    const url = String(input);

    if (url.includes("/v1/theatres?")) {
      return Response.json({
        nearbyTheatres: [
          {
            location: {
              city: "Toronto",
              geoLocation: { latitude: 43.65, longitude: -79.38 },
              provinceCode: "ON",
            },
            theatreId: 7402,
            theatreName: "Example Theatre",
          },
        ],
      });
    }

    if (url.includes("/v1/showtimes?")) {
      return Response.json([
        {
          dates: [
            {
              movies: [
                {
                  experiences: [
                    {
                      experienceTypes: ["Regular"],
                      sessions: Array.from({ length: 45 }, (_, index) => ({
                        isReservedSeating: true,
                        showStartDateTime: "2026-09-01T20:00:00",
                        vistaSessionId: 2000 + index,
                      })),
                    },
                  ],
                  name: "Example Movie",
                },
              ],
            },
          ],
        },
      ]);
    }

    if (url.includes("/seat-layout") || url.includes("/seat-availability")) {
      seatRequests += 1;
    }

    throw new Error(`Unexpected request: ${url}`);
  };

  const results = await new CineplexClient(
    "test-key",
    () => new Date("2026-09-01T12:00:00.000Z"),
  ).search({
    date: "2026-09-01",
    latitude: 43.65,
    location: "Toronto",
    longitude: -79.38,
    radiusKm: 25,
  });

  assert.equal(results.length, 45);
  assert.equal(seatRequests, 0);
});

test("discovers all nearby theatres with bounded concurrency", async (t) => {
  const originalFetch = globalThis.fetch;
  const theatreCount = 7;
  let activeShowtimeRequests = 0;
  let peakShowtimeRequests = 0;

  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (input) => {
    const url = String(input);

    if (url.includes("/v1/theatres?")) {
      return Response.json({
        nearbyTheatres: Array.from({ length: theatreCount }, (_, index) => ({
          location: {
            city: "Toronto",
            geoLocation: {
              latitude: 43.65 + index * 0.001,
              longitude: -79.38,
            },
            provinceCode: "ON",
          },
          theatreId: 7402 + index,
          theatreName: `Example Theatre ${index}`,
        })),
      });
    }

    if (url.includes("/v1/showtimes?")) {
      activeShowtimeRequests += 1;
      peakShowtimeRequests = Math.max(
        peakShowtimeRequests,
        activeShowtimeRequests,
      );

      await new Promise((resolve) => setTimeout(resolve, 10));
      activeShowtimeRequests -= 1;

      const theatreId = new URL(url).searchParams.get("locationId");
      const sessionId = Number(theatreId) + 1000;

      return Response.json([
        {
          dates: [
            {
              movies: [
                {
                  experiences: [
                    {
                      experienceTypes: ["Regular"],
                      sessions: [
                        {
                          isReservedSeating: true,
                          showStartDateTime: "2026-09-01T20:00:00",
                          vistaSessionId: sessionId,
                        },
                      ],
                    },
                  ],
                  name: `Example Movie ${theatreId}`,
                },
              ],
            },
          ],
        },
      ]);
    }

    throw new Error(`Unexpected request: ${url}`);
  };

  const results = await new CineplexClient(
    "test-key",
    () => new Date("2026-08-31T12:00:00.000Z"),
  ).search({
    date: "2026-09-01",
    latitude: 43.65,
    location: "Toronto",
    longitude: -79.38,
    radiusKm: 25,
  });

  assert.equal(results.length, theatreCount);
  assert.equal(
    new Set(results.map((result) => result.theatre.providerTheatreId)).size,
    theatreCount,
  );
  assert.equal(peakShowtimeRequests, 6);
});

test("keeps showtimes from healthy theatres when one theatre fails", async (t) => {
  const originalFetch = globalThis.fetch;
  const theatreCount = 7;
  const failedTheatreId = "7405";

  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (input) => {
    const url = String(input);

    if (url.includes("/v1/theatres?")) {
      return Response.json({
        nearbyTheatres: Array.from({ length: theatreCount }, (_, index) => ({
          location: {
            city: "Toronto",
            geoLocation: {
              latitude: 43.65 + index * 0.001,
              longitude: -79.38,
            },
            provinceCode: "ON",
          },
          theatreId: 7402 + index,
          theatreName: `Example Theatre ${index}`,
        })),
      });
    }

    if (url.includes("/v1/showtimes?")) {
      const theatreId = new URL(url).searchParams.get("locationId");

      if (theatreId === failedTheatreId) {
        return Response.json({ error: "Unavailable" }, { status: 503 });
      }

      return Response.json([
        {
          dates: [
            {
              movies: [
                {
                  experiences: [
                    {
                      experienceTypes: ["Regular"],
                      sessions: [
                        {
                          isReservedSeating: true,
                          showStartDateTime: "2026-09-01T20:00:00",
                          vistaSessionId: Number(theatreId) + 1000,
                        },
                      ],
                    },
                  ],
                  name: `Example Movie ${theatreId}`,
                },
              ],
            },
          ],
        },
      ]);
    }

    throw new Error(`Unexpected request: ${url}`);
  };

  const results = await new CineplexClient(
    "test-key",
    () => new Date("2026-08-31T12:00:00.000Z"),
  ).search({
    date: "2026-09-01",
    latitude: 43.65,
    location: "Toronto",
    longitude: -79.38,
    radiusKm: 25,
  });

  assert.equal(results.length, theatreCount - 1);
  assert.ok(
    results.every(
      (result) => result.theatre.providerTheatreId !== failedTheatreId,
    ),
  );
});
