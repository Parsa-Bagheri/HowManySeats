import assert from "node:assert/strict";
import test from "node:test";
import { buildSeatSnapshot } from "./seat-scoring";

test("counts sellable, occupied, and accessible seats", () => {
  const snapshot = buildSeatSnapshot([
    { status: "Available", type: "Standard" },
    { status: "Occupied", type: "Standard" },
    { status: "Held", type: "Standard" },
    { status: "Broken", type: "Standard" },
    { status: "Available", type: "Wheelchair" },
    { status: "Available", type: "Companion" },
    { status: "Mystery", type: "Standard" },
  ]);

  assert.equal(snapshot.sellableSeats, 3);
  assert.equal(snapshot.occupiedEstimate, 2);
  assert.equal(snapshot.accessibilityCount, 2);
});
