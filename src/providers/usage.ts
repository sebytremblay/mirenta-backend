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

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

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

export function addUsage(a: TokenUsageTotals, b: TokenUsageTotals): TokenUsageTotals {
  return {
    input_tokens: a.input_tokens + b.input_tokens,
    output_tokens: a.output_tokens + b.output_tokens,
    cache_creation_tokens: a.cache_creation_tokens + b.cache_creation_tokens,
    cache_read_tokens: a.cache_read_tokens + b.cache_read_tokens,
    requests: a.requests + b.requests,
  };
}
