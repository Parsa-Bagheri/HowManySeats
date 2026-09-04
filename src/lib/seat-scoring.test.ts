import assert from "node:assert/strict";
import test from "node:test";
import { buildSeatSnapshot } from "./seat-scoring";

test("counts standard, wheelchair, and companion seats independently", () => {
  const snapshot = buildSeatSnapshot([
    { status: "Available", type: "Standard" },
    { status: "Occupied", type: "Standard" },
    { status: "Held", type: "Standard" },
    { status: "Broken", type: "Standard" },
    { status: "Available", type: "Wheelchair" },
    { status: "Reserved", type: "Wheelchair" },
    { status: "Available", type: "Companion" },
    { status: "Sold", type: "Companion" },
    { status: "Broken", type: "Wheelchair" },
    { status: "Unavailable", type: "Companion" },
    { status: "Mystery", type: "Standard" },
  ]);

  assert.equal(snapshot.sellableSeats, 3);
  assert.equal(snapshot.occupiedEstimate, 2);
  assert.equal(snapshot.accessibleSeats, 2);
  assert.equal(snapshot.occupiedAccessibleSeats, 1);
  assert.equal(snapshot.companionSeats, 2);
  assert.equal(snapshot.occupiedCompanionSeats, 1);
  assert.equal(snapshot.accessibilityCount, 4);
});

test("does not count companion seats as open wheelchair availability", () => {
  const snapshot = buildSeatSnapshot([
    { status: "Occupied", type: "Wheelchair" },
    { status: "Available", type: "Companion" },
  ]);

  assert.equal(snapshot.accessibleSeats - snapshot.occupiedAccessibleSeats, 0);
  assert.equal(snapshot.companionSeats - snapshot.occupiedCompanionSeats, 1);
});
