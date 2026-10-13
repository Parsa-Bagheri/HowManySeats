import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { GET, POST } from "./route";

test("watch API validates actual bytes and rejects forged metadata before any provider work", async () => {
  for (const body of [" ".repeat(1100), JSON.stringify({ theatreId: "7402", showtimeId: "900001", startsAt: "2099-01-01", movieTitle: "Forged" }), JSON.stringify({ theatreId: "https://example.com", showtimeId: "1" })]) {
    const response = await POST(new Request("http://localhost/api/watches", { method: "POST", body, headers: { "Content-Type": "application/json" } }));
    assert.equal(response.status, 400);
  }
});
test("watch API creates a fixture watch and returns persisted pending data across connections", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "watch-api-"));
  const previous = { WATCH_BACKEND: process.env.WATCH_BACKEND, WATCH_MODE: process.env.WATCH_MODE, WATCH_DB_PATH: process.env.WATCH_DB_PATH };
  process.env.WATCH_BACKEND = "local"; process.env.WATCH_MODE = "fixture"; process.env.WATCH_DB_PATH = join(directory, "db.sqlite");
  t.after(async () => { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } assert(resolve(directory).startsWith(resolve(tmpdir()) + sep)); await rm(directory, { recursive: true, force: true }); });
  const response = await POST(new Request("http://localhost/api/watches", { method: "POST", body: JSON.stringify({ theatreId: "7402", showtimeId: "900001" }) }));
  assert.equal(response.status, 201); const created = await response.json(); assert.equal(created.watch.state, "pending"); assert.equal(created.watch.fixture, true);
  const read = await GET(new Request("http://localhost/api/watches?id=cineplex-7402-900001")); assert.equal(read.status, 200);
  const body = await read.json(); assert.equal(body.watches.length, 1); assert.equal(body.watches[0].screening.theatre.name, "Fixture Cinema Waterloo");
  assert.equal((await GET(new Request("http://localhost/api/watches?id=bad"))).status, 400);
  assert.equal((await GET(new Request(`http://localhost/api/watches?${Array.from({ length: 11 }, () => "id=cineplex-7402-900001").join("&")}`))).status, 400);
});
