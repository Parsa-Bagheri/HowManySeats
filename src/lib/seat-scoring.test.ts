import assert from "node:assert/strict";
import test from "node:test";
import { buildSeatSnapshot } from "./seat-scoring";

test("classifies sellable, blocked, accessibility, and unknown seats", () => {
  const snapshot = buildSeatSnapshot("showtime-1", [
    { status: "Available", type: "Standard" },
    { status: "Occupied", type: "Standard" },
    { status: "Held", type: "Standard" },
    { status: "Broken", type: "Standard" },
    { status: "Available", type: "Wheelchair" },
    { status: "Available", type: "Companion" },
    { status: "Mystery", type: "Standard" },
  ]);

  assert.equal(snapshot.totalSeats, 7);
  assert.equal(snapshot.sellableSeats, 3);
  assert.equal(snapshot.availableCount, 1);
  assert.equal(snapshot.occupiedEstimate, 2);
  assert.equal(snapshot.blockedCount, 1);
  assert.equal(snapshot.accessibilityCount, 2);
  assert.equal(snapshot.unknownCount, 1);
  assert.equal(snapshot.confidence, "low-but-interesting");
});
