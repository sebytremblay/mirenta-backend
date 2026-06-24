import { test } from "node:test";
import assert from "node:assert/strict";
import { computeCost, resolvePricing } from "../../src/providers/pricing.ts";
import type { TokenUsageTotals } from "../../src/providers/usage.ts";

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
  approx(computeCost("claude-haiku-4-5", ONE_MTOK_EACH), 7.35);
});

test("computeCost resolves a dated model id by prefix", () => {
  approx(computeCost("claude-haiku-4-5-20251001", ONE_MTOK_EACH), 7.35);
});

test("computeCost prices the Sonnet and Opus tiers", () => {
  approx(computeCost("claude-sonnet-4-6", ONE_MTOK_EACH), 22.05);
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
  approx(computeCost("claude-haiku-4-5", small), 0.02);
});

test("an unpriced model yields zero cost rather than a guess", () => {
  assert.equal(resolvePricing("claude-unknown-9"), null);
  assert.equal(computeCost("claude-unknown-9", ONE_MTOK_EACH), 0);
});
