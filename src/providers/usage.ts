// Token-usage accounting shared by both agent paths. The Website Builder reads
// usage off the Messages API response (`response.usage`); the Research Agent
// accumulates it across the Managed Agents `span.model_request_end` events, each
// of which carries one `model_usage` record. Both records share the Anthropic
// usage field names, so one normalizer serves both, and the worker persists the
// accumulated totals per agent stage (see src/db/client.ts insertTokenUsage).
//
// This module owns the raw token math only. Cost attribution lives in pricing.ts,
// which multiplies these totals by the per-model rate table.

// The internal totals shape. `requests` counts the model requests the totals sum
// over: one for a builder call, one per research model_request_end event. The
// shorter cache field names map onto the token_usage columns directly.
export interface TokenUsageTotals {
  input_tokens: number;
  output_tokens: number;
  cache_creation_tokens: number;
  cache_read_tokens: number;
  requests: number;
}

export function emptyUsage(): TokenUsageTotals {
  return {
    input_tokens: 0,
    output_tokens: 0,
    cache_creation_tokens: 0,
    cache_read_tokens: 0,
    requests: 0,
  };
}

// Coerce an unknown field to a finite non-negative count. A malformed or absent
// usage field reads as zero rather than poisoning the totals with NaN, since a
// telemetry gap must never break the pipeline.
function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

// Normalize one Anthropic usage record into the internal totals. The Messages
// API `usage` object and the Managed Agents `model_usage`/`usage` payloads carry
// the same four token fields, so this normalizer serves every source. `requests`
// records how many model requests this record represents (one by default).
export function usageFromRaw(raw: unknown, requests = 1): TokenUsageTotals {
  const u = (raw ?? {}) as Record<string, unknown>;
  return {
    input_tokens: count(u.input_tokens),
    output_tokens: count(u.output_tokens),
    cache_creation_tokens: count(u.cache_creation_input_tokens),
    cache_read_tokens: count(u.cache_read_input_tokens),
    requests,
  };
}

// Sum two totals. Pure, so the accumulation a research session runs across many
// model_request_end events and the builder runs across its retry attempts stays
// unit-testable without a live session.
export function addUsage(a: TokenUsageTotals, b: TokenUsageTotals): TokenUsageTotals {
  return {
    input_tokens: a.input_tokens + b.input_tokens,
    output_tokens: a.output_tokens + b.output_tokens,
    cache_creation_tokens: a.cache_creation_tokens + b.cache_creation_tokens,
    cache_read_tokens: a.cache_read_tokens + b.cache_read_tokens,
    requests: a.requests + b.requests,
  };
}
