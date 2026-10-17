import assert from "node:assert/strict";
import test from "node:test";
import { CineplexClient } from "@/lib/cineplex-client";
import { GET } from "./route";

test("search API accepts least-crowded sorting and passes it to discovery", async (t) => {
  const originalSearch = CineplexClient.prototype.search;
  let sortBy: string | undefined;
  t.after(() => { CineplexClient.prototype.search = originalSearch; });
  CineplexClient.prototype.search = async (query) => {
    sortBy = query.sortBy;
    return [];
  };
  const response = await GET(new Request("http://localhost/api/search?location=Toronto&date=2026-10-18&radiusKm=25&sortBy=occupancy-asc"));
  assert.equal(response.status, 200);
  assert.equal(sortBy, "occupancy-asc");
  assert.deepEqual((await response.json()).results, []);
});

test("search API rejects unrecognized sorting before discovery", async () => {
  const response = await GET(new Request("http://localhost/api/search?location=Toronto&date=2026-10-18&radiusKm=25&sortBy=crowding-desc"));
  assert.equal(response.status, 400);
});
