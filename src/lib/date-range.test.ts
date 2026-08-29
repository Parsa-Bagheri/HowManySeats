import assert from "node:assert/strict";
import test from "node:test";
import {
  addDays,
  formatDateRangeLabel,
  getSearchDates,
  isValidDateInput,
  normalizeEndDate
} from "./date-range";

test("builds inclusive date ranges up to three days", () => {
  assert.deepEqual(getSearchDates("2026-08-29", "2026-08-31"), [
    "2026-08-29",
    "2026-08-30",
    "2026-08-31"
  ]);
  assert.deepEqual(getSearchDates("2026-08-29"), ["2026-08-29"]);
  assert.equal(getSearchDates("2026-08-29", "2026-09-01"), undefined);
});

test("uses UTC date arithmetic across leap days and rejects invalid dates", () => {
  assert.equal(addDays("2028-02-28", 2), "2028-03-01");
  assert.equal(isValidDateInput("2028-02-29"), true);
  assert.equal(isValidDateInput("2026-02-29"), false);
  assert.equal(getSearchDates("not-a-date", "2026-08-29"), undefined);
});

test("normalizes end dates and formats a compact range label", () => {
  assert.equal(normalizeEndDate("2026-08-29", "2026-09-04"), "2026-08-31");
  assert.equal(normalizeEndDate("2026-08-29", "2026-08-28"), "2026-08-29");
  assert.equal(formatDateRangeLabel("2026-08-29", "2026-08-29"), "2026-08-29");
  assert.equal(formatDateRangeLabel("2026-08-29", "2026-08-31"), "2026-08-29 to 2026-08-31");
});
