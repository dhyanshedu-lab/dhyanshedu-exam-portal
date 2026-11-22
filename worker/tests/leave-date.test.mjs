import test from "node:test";
import assert from "node:assert/strict";
import { isISODate, isCoverageComplete } from "../study.js";

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

test("requires coverage for every assigned class and batch", () => {
  const batches = [
    { id: "batch-a", class_id: 7, subject_id: 2 },
    { id: "batch-b", class_id: 7, subject_id: 2 },
    { id: "batch-c", class_id: 8, subject_id: 3 }
  ];
  const classes = [
    { class_id: 7, subject_id: 2 },
    { class_id: 8, subject_id: 3 }
  ];
  assert.equal(isCoverageComplete({ batches, classes, coverage: [
    { scope_type: "class_subject", class_id: 7, subject_id: 2 },
    { scope_type: "class_subject", class_id: 8, subject_id: 3 }
  ] }), true);
  assert.equal(isCoverageComplete({ batches, classes, coverage: [
    { scope_type: "batch", batch_id: "batch-a" },
    { scope_type: "batch", batch_id: "batch-b" },
    { scope_type: "batch", batch_id: "batch-c" }
  ] }), false);
  assert.equal(isCoverageComplete({ batches, classes, coverage: [
    { scope_type: "class_subject", class_id: 7, subject_id: 2 },
    { scope_type: "class_subject", class_id: 8, subject_id: 3 },
    { scope_type: "batch", batch_id: "batch-c" }
  ] }), true);
  assert.equal(isCoverageComplete({ batches, classes: [], coverage: [
    { scope_type: "batch", batch_id: "batch-a" },
    { scope_type: "batch", batch_id: "batch-b" },
    { scope_type: "batch", batch_id: "batch-c" }
  ] }), true);
});

test("rejects duplicate or malformed coverage scopes", () => {
  assert.equal(isCoverageComplete({ coverage: [
    { scope_type: "batch", batch_id: "batch-a" },
    { scope_type: "batch", batch_id: "batch-a" }
  ] }), false);
  assert.equal(isCoverageComplete({ coverage: [
    { scope_type: "class_subject", class_id: 7, subject_id: 2 },
    { scope_type: "class_subject", class_id: 7, subject_id: 2 }
  ] }), false);
  assert.equal(isCoverageComplete({ coverage: [{ scope_type: "other" }] }), false);
});
