import test from "node:test";
import assert from "node:assert/strict";
import { isISODate } from "../study.js";

test("accepts valid ISO calendar dates", () => {
  assert.equal(isISODate("2026-11-23"), true);
  assert.equal(isISODate("2024-02-29"), true);
});

test("rejects malformed and impossible calendar dates", () => {
  for (const value of ["23-11-2026", "2026/11/23", "2026-2-3", "2026-02-29", "2026-11-31", "", null]) {
    assert.equal(isISODate(value), false, String(value));
  }
});

test("rejects whitespace and timestamps", () => {
  assert.equal(isISODate(" 2026-11-23"), false);
  assert.equal(isISODate("2026-11-23T00:00:00Z"), false);
});
