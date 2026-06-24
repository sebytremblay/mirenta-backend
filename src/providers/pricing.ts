import type { TokenUsageTotals } from "./usage.ts";

// Per-MTok USD rates from the published Anthropic price list.
interface ModelRate {
  input: number;
  output: number;
}

// Standard multipliers over the input rate at the default 5-minute TTL. A
// 1-hour TTL would price writes at 2x input instead.
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

// Models pin to a dated id (`claude-haiku-4-5-20251001`), so an exact lookup
// falls back to the longest-prefix match against the family keys. Returns null
// for an unpriced model rather than guessing.
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
