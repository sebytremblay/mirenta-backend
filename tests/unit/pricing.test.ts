// Unit tests for cost attribution. The worker stamps each token_usage row with a
// USD cost at write time, so the rate table and the per-token math are
// load-bearing for the cost-per-lead baseline (D33 precursor infra). These pin
// the math, the dated-id resolution, and the unpriced-model fallback.

import { test } from "node:test";
import assert from "node:assert/strict";
import { computeCost, resolvePricing } from "../../src/providers/pricing.ts";
import type { TokenUsageTotals } from "../../src/providers/usage.ts";

// One million of every token kind, so the per-MTok rates read straight off the
// result: input 1x, output 5x, cache write 1.25x input, cache read 0.1x input.
const ONE_MTOK_EACH: TokenUsageTotals = {
  input_tokens: 1_000_000,
  output_tokens: 1_000_000,
  cache_creation_tokens: 1_000_000,
  cache_read_tokens: 1_000_000,
  requests: 1,
};

function approx(actual: number, expected: number): void {
  assert.ok(
    Math.abs(actual - expected) < 1e-9,
    `expected ${expected}, got ${actual}`,
  );
}

test("computeCost prices Haiku 4.5 at the published rate plus cache multipliers", () => {
  // 1 (input) + 5 (output) + 1.25 (cache write) + 0.10 (cache read) = 7.35 USD.
  approx(computeCost("claude-haiku-4-5", ONE_MTOK_EACH), 7.35);
});

test("computeCost resolves a dated model id by prefix", () => {
  // The pipeline pins the dated Haiku id (D47); pricing must still resolve it.
  approx(computeCost("claude-haiku-4-5-20251001", ONE_MTOK_EACH), 7.35);
});

test("computeCost prices the Sonnet and Opus tiers for the D35 restoration", () => {
  // Sonnet 4.6: 3 + 15 + 3.75 + 0.30 = 22.05.
  approx(computeCost("claude-sonnet-4-6", ONE_MTOK_EACH), 22.05);
  // Opus 4.8: 5 + 25 + 6.25 + 0.50 = 36.75.
  approx(computeCost("claude-opus-4-8", ONE_MTOK_EACH), 36.75);
});

test("computeCost scales linearly with token counts", () => {
  const small: TokenUsageTotals = {
    input_tokens: 10_000,
    output_tokens: 2_000,
    cache_creation_tokens: 0,
    cache_read_tokens: 0,
    requests: 1,
  };
  // (10000 * 1 + 2000 * 5) / 1e6 = 20000 / 1e6 = 0.02 USD.
  approx(computeCost("claude-haiku-4-5", small), 0.02);
});

test("an unpriced model yields zero cost rather than a guess", () => {
  // A new model id surfaces as a zero-cost row; telemetry never breaks on it.
  assert.equal(resolvePricing("claude-unknown-9"), null);
  assert.equal(computeCost("claude-unknown-9", ONE_MTOK_EACH), 0);
});
