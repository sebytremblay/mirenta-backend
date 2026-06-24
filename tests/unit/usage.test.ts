import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyUsage, usageFromRaw, addUsage } from "../../src/providers/usage.ts";

test("emptyUsage starts every counter at zero", () => {
  assert.deepEqual(emptyUsage(), {
    input_tokens: 0,
    output_tokens: 0,
    cache_creation_tokens: 0,
    cache_read_tokens: 0,
    requests: 0,
  });
});

test("usageFromRaw maps the Anthropic field names and defaults to one request", () => {
  // The Messages `usage` object and the Managed Agents `model_usage` record share
  // these field names, so one normalizer serves both.
  const totals = usageFromRaw({
    input_tokens: 100,
    output_tokens: 40,
    cache_creation_input_tokens: 200,
    cache_read_input_tokens: 1000,
    speed: "standard",
  });
  assert.deepEqual(totals, {
    input_tokens: 100,
    output_tokens: 40,
    cache_creation_tokens: 200,
    cache_read_tokens: 1000,
    requests: 1,
  });
});

test("usageFromRaw treats missing or malformed fields as zero", () => {
  assert.deepEqual(usageFromRaw(undefined), emptyUsage_withRequests(1));
  assert.deepEqual(usageFromRaw({}), emptyUsage_withRequests(1));
  assert.deepEqual(
    usageFromRaw({ input_tokens: "lots", output_tokens: -5, cache_read_input_tokens: Number.NaN }),
    emptyUsage_withRequests(1),
  );
});

test("usageFromRaw records the request count it is told", () => {
  assert.equal(usageFromRaw({ input_tokens: 5 }, 0).requests, 0);
  assert.equal(usageFromRaw({ input_tokens: 5 }, 3).requests, 3);
});

test("addUsage sums totals across many records", () => {
  const events = [
    { input_tokens: 1000, output_tokens: 200, cache_creation_input_tokens: 500, cache_read_input_tokens: 0 },
    { input_tokens: 50, output_tokens: 300, cache_creation_input_tokens: 0, cache_read_input_tokens: 1500 },
    { input_tokens: 25, output_tokens: 75, cache_creation_input_tokens: 0, cache_read_input_tokens: 1500 },
  ];
  const total = events.reduce((acc, e) => addUsage(acc, usageFromRaw(e, 1)), emptyUsage());
  assert.deepEqual(total, {
    input_tokens: 1075,
    output_tokens: 575,
    cache_creation_tokens: 500,
    cache_read_tokens: 3000,
    requests: 3,
  });
});

function emptyUsage_withRequests(requests: number) {
  return { ...emptyUsage(), requests };
}
