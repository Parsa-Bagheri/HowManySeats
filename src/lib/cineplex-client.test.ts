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
      amenities: [],
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
