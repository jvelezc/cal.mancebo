const { test } = require("node:test");
const assert = require("node:assert/strict");
const { requiredFailures, core, browser } = require("./required-checks.cjs");
function state(e2e = false) {
  return {
    "trust-check": { result: "success", outputs: { "is-trusted": "true" } },
    prepare: { result: "success", outputs: { "has-files-requiring-all-checks": "true", "has-prisma-changes": "false", "run-e2e": String(e2e) } },
    ...Object.fromEntries(core.map((job) => [job, { result: "success" }])),
    ...Object.fromEntries(browser.map((job) => [job, { result: e2e ? "success" : "skipped" }])),
  };
}
test("accepts deliberately skipped browser jobs only when their existing gate is off", () => {
  assert.deepEqual(requiredFailures(state()), []);
  const enabled = state(true); enabled.build.result = "skipped";
  assert.deepEqual(requiredFailures(enabled), ["build"]);
});
test("rejects failure cancellation omission or skipping of every required core and enabled browser job", () => {
  for (const job of [...core, ...browser]) for (const outcome of ["failure", "cancelled", "skipped", undefined]) {
    const needs = state(true); needs[job].result = outcome;
    assert.deepEqual(requiredFailures(needs), [job]);
  }
});
test("requires successful migration qualification when schema changes", () => {
  const needs = state(); needs.prepare.outputs["has-prisma-changes"] = "true";
  assert.deepEqual(requiredFailures(needs), ["check-prisma-migrations"]);
  needs["check-prisma-migrations"] = { result: "success" };
  assert.deepEqual(requiredFailures(needs), []);
});
test("fails closed for an untrusted source failed preparation or unknown gate output", () => {
  const untrusted = state(); untrusted["trust-check"].outputs["is-trusted"] = "false";
  assert.deepEqual(requiredFailures(untrusted), ["untrusted-source"]);
  const failed = state(); failed.prepare.result = "failure";
  assert.deepEqual(requiredFailures(failed), ["prepare"]);
  const missing = state(); delete missing.prepare.outputs["run-e2e"];
  assert.deepEqual(requiredFailures(missing), ["missing-or-invalid-run-e2e"]);
});
