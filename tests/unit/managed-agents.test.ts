import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyIdle } from "../../src/providers/managed-agents.ts";

test("a refusal classifies as refusal regardless of result state", () => {
  assert.equal(classifyIdle("refusal", false), "refusal");
  assert.equal(classifyIdle("refusal", true), "refusal");
});

test("a held result returns on any non-refusal idle", () => {
  assert.equal(classifyIdle("requires_action", true), "return");
  assert.equal(classifyIdle("end_turn", true), "return");
  assert.equal(classifyIdle(undefined, true), "return");
});

test("requires_action with no result keeps draining", () => {
  assert.equal(classifyIdle("requires_action", false), "wait");
});

test("a terminal idle with no result is a session error", () => {
  assert.equal(classifyIdle("end_turn", false), "error");
  assert.equal(classifyIdle("retries_exhausted", false), "error");
  assert.equal(classifyIdle(undefined, false), "error");
});
