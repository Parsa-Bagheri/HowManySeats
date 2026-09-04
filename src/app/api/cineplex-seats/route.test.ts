import assert from "node:assert/strict";
import test from "node:test";
import { POST } from "./route";

test("returns a bounded batch of Cineplex seat snapshots", async (t) => {
  const originalFetch = globalThis.fetch;

  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (input) => {
    const url = String(input);

    if (url.includes("/seat-layout")) {
      return Response.json({
        standardSeats: {
          rows: [{ seats: [{ id: "A1", type: "Standard" }] }],
        },
      });
    }

    if (url.includes("/seat-availability")) {
      return Response.json({ seatAvailabilities: { A1: "Available" } });
    }

    throw new Error(`Unexpected request: ${url}`);
  };

  const response = await POST(
    new Request("http://localhost/api/cineplex-seats", {
      body: JSON.stringify({
        requests: [
          {
            resultId: "cineplex-7402-454782",
            showtimeId: "454782",
            theatreId: "7402",
          },
        ],
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    }),
  );
  const body = (await response.json()) as {
    failedResultIds: string[];
    results: Array<{ resultId: string; snapshot: { sellableSeats: number } }>;
  };

  assert.equal(response.status, 200);
  assert.deepEqual(body.failedResultIds, []);
  assert.equal(body.results[0]?.resultId, "cineplex-7402-454782");
  assert.equal(body.results[0]?.snapshot.sellableSeats, 1);
});

test("rejects Cineplex seat batches larger than 40", async () => {
  const response = await POST(
    new Request("http://localhost/api/cineplex-seats", {
      body: JSON.stringify({
        requests: Array.from({ length: 41 }, (_, index) => ({
          resultId: `cineplex-7402-${index}`,
          showtimeId: String(index),
          theatreId: "7402",
        })),
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    }),
  );

  assert.equal(response.status, 400);
});
