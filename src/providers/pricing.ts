// Cost attribution for token usage. Multiplies the accumulated TokenUsageTotals
// (usage.ts) by a per-model USD rate so the worker records a `cost_usd` alongside
// the raw counts. Storing the computed cost at write time means a later price
// change never rewrites history: each token_usage row preserves the cost as it
// stood when the work ran. This is the precursor metric the MVP lacks (D33: no
// spend ceiling yet), so a baseline cost-per-lead exists before any optimization.

import type { TokenUsageTotals } from "./usage.ts";

// Per-MTok USD rates. `input` and `output` come from the published Anthropic
// price list. The cache rates follow the standard multipliers over the input
// rate: a 5-minute-TTL cache write costs 1.25x input, a cache read costs 0.1x
// input. The pipeline pins Haiku 4.5 for the prove-out (D47); the Sonnet, Opus,
// and Fable tiers ride along for the D35 model-tier restoration.
interface ModelRate {
  input: number;
  output: number;
}

// Cache-write rate assumes the default 5-minute TTL the byte-stable prompt prefix
// uses (D8). A 1-hour TTL would price writes at 2x input instead.
const CACHE_WRITE_MULTIPLIER = 1.25;
const CACHE_READ_MULTIPLIER = 0.1;

const RATES: Record<string, ModelRate> = {
  "claude-haiku-4-5": { input: 1, output: 5 },
  "claude-sonnet-4-5": { input: 3, output: 15 },
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-opus-4-6": { input: 5, output: 25 },
  "claude-opus-4-7": { input: 5, output: 25 },
  "claude-opus-4-8": { input: 5, output: 25 },
  "claude-fable-5": { input: 10, output: 50 },
};

// Resolve a model id to its rate. Models pin to a dated id (for example
// `claude-haiku-4-5-20251001`), so an exact lookup falls back to the
// longest-prefix match against the family keys. Returns null for an unpriced
// model so the caller records the raw counts and a zero cost rather than guessing.
export function resolvePricing(model: string): ModelRate | null {
  const exact = RATES[model];
  if (exact) return exact;
  let best: ModelRate | null = null;
  let bestLength = 0;
  for (const [key, rate] of Object.entries(RATES)) {
    if (model.startsWith(key) && key.length > bestLength) {
      best = rate;
      bestLength = key.length;
    }
  }
  return best;
}

// Attribute a USD cost to one usage record. Cache writes and reads price off the
// input rate via the standard multipliers. An unpriced model yields zero, so a
// new model id never breaks telemetry; it surfaces as a zero-cost row instead.
export function computeCost(model: string, usage: TokenUsageTotals): number {
  const rate = resolvePricing(model);
  if (!rate) return 0;
  const perMillion =
    usage.input_tokens * rate.input +
    usage.output_tokens * rate.output +
    usage.cache_creation_tokens * rate.input * CACHE_WRITE_MULTIPLIER +
    usage.cache_read_tokens * rate.input * CACHE_READ_MULTIPLIER;
  return perMillion / 1_000_000;
}
