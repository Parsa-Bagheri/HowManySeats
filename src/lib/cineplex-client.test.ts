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
      id: "7402",
      cineplexId: "7402",
      name: "Example Theatre",
      city: "Example City",
      province: "ON",
    },
    "2026-08-31",
  );

  assert.equal(showtimes[0]?.purchaseUrl, purchaseUrl);
  assert.equal(showtimes[0]?.seatPreviewUrl, seatPreviewUrl);
  assert.equal(showtimes[1]?.purchaseUrl, undefined);
  assert.equal(
    showtimes[1]?.seatPreviewUrl,
    "https://www.cineplex.com/en-Mobile/ticketing/preview?theatreId=7402&showtimeId=454783&dbox=False",
  );
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
                      sessions: Array.from({ length: 5 }, (_, index) => ({
                        vistaSessionId: 1000 + index,
                        showStartDateTime: `2026-09-01T${10 + index}:00:00`,
                        isReservedSeating: true,
                      })),
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

  const client = new CineplexClient("test-key");
  const results = await client.search({
    location: "Toronto",
    date: "2026-09-01",
    radiusKm: 25,
    latitude: 43.65,
    longitude: -79.38,
  });

  assert.equal(results.length, 5);
  assert.equal(peakSeatRequests, 8);
});
