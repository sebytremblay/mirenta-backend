// Unit tests for the Managed Agents idle-classification logic. The worker maps
// the research session's terminal idle to a transient or permanent outcome, so
// the branch that decides return-versus-refuse-versus-wait-versus-error is
// load-bearing and pinned here. The live session drive is proven by the
// end-to-end pipeline runner, not duplicated here (it would burn tokens).

import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyIdle } from "../../src/providers/managed-agents.ts";

test("a refusal classifies as refusal regardless of result state", () => {
  assert.equal(classifyIdle("refusal", false), "refusal");
  // A refusal stop_reason wins even if a stray result was harvested.
  assert.equal(classifyIdle("refusal", true), "refusal");
});

test("a held result returns on any non-refusal idle", () => {
  assert.equal(classifyIdle("requires_action", true), "return");
  assert.equal(classifyIdle("end_turn", true), "return");
  assert.equal(classifyIdle(undefined, true), "return");
});

test("requires_action with no result keeps draining", () => {
  // The session parks on a client event (our custom_tool_result ack). The loop
  // must keep reading rather than treat the park as a failure.
  assert.equal(classifyIdle("requires_action", false), "wait");
});

test("a terminal idle with no result is a session error", () => {
  // end_turn or retries_exhausted without the final tool means the agent quit
  // without emitting research: transient, retried via the lease.
  assert.equal(classifyIdle("end_turn", false), "error");
  assert.equal(classifyIdle("retries_exhausted", false), "error");
  assert.equal(classifyIdle(undefined, false), "error");
});
