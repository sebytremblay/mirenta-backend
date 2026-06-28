import { test } from "node:test";
import assert from "node:assert/strict";
import {
  evaluateRecipe,
  RecipeError,
  type MetricRecipe,
  type RecipeInputs,
} from "../../src/domain/recipe.ts";
import { assertValueModelContract } from "../../src/domain/value-contract.ts";

function sourced(value: number, estimated = false): { value: number; estimated: boolean } {
  return { value, estimated };
}

test("identity passes a single numeric input through and formats by unit", () => {
  const recipe: MetricRecipe = {
    op: "identity",
    unit: "count",
    sectionTitle: "What this adds",
    headlineLabel: "New signups",
    mechanismTemplate: "The page projects {result} from {input.signups}.",
    inputs: [{ key: "signups", label: "monthly signups", min: 0, max: 100000 }],
    maxFactor: 1,
    resultCeiling: 1000000,
  };
  const out = evaluateRecipe(recipe, { values: { signups: sourced(1200) } });
  assert.equal(out.headline.value, "1,200");
  assert.match(out.mechanism, /monthly signups/);
  assert.equal(out.footnote, undefined);
});

test("the mechanism fills {value.<key>} with the clamped number and {input.<key>} with the label", () => {
  const recipe: MetricRecipe = {
    op: "multiply",
    unit: "hours_per_week",
    sectionTitle: "Time back",
    headlineLabel: "Hours reclaimed",
    // {result} carries its own unit; {value.*} is the number; {input.*} the label.
    mechanismTemplate:
      "Mirenta returns {result} by automating the {value.pitches} pitches you send each week that each take {value.hours} hours by hand ({input.hours}).",
    inputs: [
      { key: "pitches", label: "weekly pitches", min: 0, max: 40 },
      { key: "hours", label: "hours per pitch", min: 0, max: 8 },
    ],
    maxFactor: 1000,
    resultCeiling: 1000,
  };
  const out = evaluateRecipe(recipe, { values: { pitches: sourced(14), hours: sourced(2) } });
  assert.equal(out.headline.value, "~28 hours each week");
  // The number lands in the value slots, the label only in the input slot, and
  // no descriptive label leaks where the sentence reads as a number.
  assert.equal(
    out.mechanism,
    "Mirenta returns ~28 hours each week by automating the 14 pitches you send each week that each take 2 hours by hand (hours per pitch).",
  );
  assert.ok(!out.mechanism.includes("weekly pitches"), "the label never leaks into a number slot");
});

test("qualitative identity renders the literal verbatim with no numeric inputs", () => {
  const recipe: MetricRecipe = {
    op: "identity",
    unit: "qualitative",
    sectionTitle: "Why this matters",
    headlineLabel: "The case this page makes",
    mechanismTemplate: "The page states a point of view: {result}.",
    inputs: [],
    maxFactor: 1,
    resultCeiling: 0,
    literalValue: "A research-led conversation in the founder's own language",
  };
  const out = evaluateRecipe(recipe, { values: {} });
  assert.equal(out.headline.value, "A research-led conversation in the founder's own language");
  assert.equal(out.footnote, undefined);
});

test("qualitative recipe without a literalValue throws", () => {
  const recipe: MetricRecipe = {
    op: "identity",
    unit: "qualitative",
    sectionTitle: "X",
    headlineLabel: "Y",
    mechanismTemplate: "{result}",
    inputs: [],
    maxFactor: 1,
    resultCeiling: 0,
  };
  assert.throws(() => evaluateRecipe(recipe, { values: {} }), RecipeError);
});

test("sum adds inputs and formats currency", () => {
  const recipe: MetricRecipe = {
    op: "sum",
    unit: "currency_usd",
    sectionTitle: "What this saves",
    headlineLabel: "Annual saving",
    mechanismTemplate: "Adds {input.tools} and {input.contractors} to {result}.",
    inputs: [
      { key: "tools", label: "tooling spend", min: 0, max: 100000 },
      { key: "contractors", label: "contractor spend", min: 0, max: 500000 },
    ],
    maxFactor: 1,
    resultCeiling: 10000000,
  };
  const out = evaluateRecipe(recipe, {
    values: { tools: sourced(12000), contractors: sourced(48000) },
  });
  assert.equal(out.headline.value, "$60,000 per year");
});

test("multiply clamps each input then bounds the product by maxFactor", () => {
  const recipe: MetricRecipe = {
    op: "multiply",
    unit: "currency_usd",
    sectionTitle: "Pipeline value",
    headlineLabel: "Added pipeline",
    mechanismTemplate: "{result}",
    inputs: [
      { key: "deals", label: "deals", min: 0, max: 10 },
      { key: "size", label: "deal size", min: 0, max: 5000 },
    ],
    maxFactor: 50000,
    resultCeiling: 10000000,
  };
  // 8 deals clamped fine, 4000 size fine -> 32000, under maxFactor.
  const out = evaluateRecipe(recipe, { values: { deals: sourced(8), size: sourced(4000) } });
  assert.equal(out.headline.value, "$32,000 per year");
});

test("multiply throws when the product exceeds maxFactor (the overstated-ROI guard)", () => {
  const recipe: MetricRecipe = {
    op: "multiply",
    unit: "currency_usd",
    sectionTitle: "X",
    headlineLabel: "Y",
    mechanismTemplate: "{result}",
    inputs: [
      { key: "reps", label: "reps", min: 0, max: 100 },
      { key: "meetings", label: "meetings", min: 0, max: 100 },
    ],
    maxFactor: 100, // a tight ceiling: 100 reps x 100 meetings = 10000 trips it
    resultCeiling: 10000000,
  };
  assert.throws(
    () => evaluateRecipe(recipe, { values: { reps: sourced(100), meetings: sourced(100) } }),
    /exceeds maxFactor/,
  );
});

test("ratio divides numerator by the required denominator", () => {
  const recipe: MetricRecipe = {
    op: "ratio",
    unit: "currency_usd",
    sectionTitle: "Per-customer cost",
    headlineLabel: "Cost per customer",
    mechanismTemplate: "{result}",
    inputs: [
      { key: "spend", label: "spend", min: 0, max: 1000000 },
      { key: "customers", label: "customers", min: 1, max: 100000 },
    ],
    maxFactor: 1,
    resultCeiling: 1000000,
    numeratorKey: "spend",
    denominatorKey: "customers",
  };
  const out = evaluateRecipe(recipe, {
    values: { spend: sourced(120000), customers: sourced(240) },
  });
  assert.equal(out.headline.value, "$500 per year");
});

test("ratio without a denominator key throws", () => {
  const recipe: MetricRecipe = {
    op: "ratio",
    unit: "count",
    sectionTitle: "X",
    headlineLabel: "Y",
    mechanismTemplate: "{result}",
    inputs: [{ key: "spend", label: "spend", min: 0, max: 100 }],
    maxFactor: 1,
    resultCeiling: 100,
    numeratorKey: "spend",
  };
  assert.throws(() => evaluateRecipe(recipe, { values: { spend: sourced(10) } }), RecipeError);
});

test("ratio with a zero denominator throws rather than dividing", () => {
  const recipe: MetricRecipe = {
    op: "ratio",
    unit: "count",
    sectionTitle: "X",
    headlineLabel: "Y",
    mechanismTemplate: "{result}",
    inputs: [
      { key: "spend", label: "spend", min: 0, max: 100 },
      { key: "customers", label: "customers", min: 0, max: 100 },
    ],
    maxFactor: 1,
    resultCeiling: 100,
    numeratorKey: "spend",
    denominatorKey: "customers",
  };
  assert.throws(
    () => evaluateRecipe(recipe, { values: { spend: sourced(10), customers: sourced(0) } }),
    /denominator is zero/,
  );
});

test("range_from_band renders the [low, high] pair for the sourced band", () => {
  const recipe: MetricRecipe = {
    op: "range_from_band",
    unit: "hours_per_week",
    sectionTitle: "What this frees up",
    headlineLabel: "Founder time reclaimed",
    mechanismTemplate: "A {result} lift off the founder's week.",
    inputs: [],
    maxFactor: 1,
    resultCeiling: 168,
    bands: [
      { name: "pre_seed", low: 2, high: 4 },
      { name: "seed", low: 4, high: 6 },
      { name: "series_a", low: 6, high: 9 },
    ],
  };
  const out = evaluateRecipe(recipe, { values: {}, band: { name: "seed", estimated: false } });
  assert.equal(out.headline.value, "~4 to 6 hours each week");
});

test("range_from_band throws when the sourced band is not in the recipe", () => {
  const recipe: MetricRecipe = {
    op: "range_from_band",
    unit: "hours_per_week",
    sectionTitle: "X",
    headlineLabel: "Y",
    mechanismTemplate: "{result}",
    inputs: [],
    maxFactor: 1,
    resultCeiling: 168,
    bands: [{ name: "seed", low: 4, high: 6 }],
  };
  assert.throws(
    () => evaluateRecipe(recipe, { values: {}, band: { name: "growth", estimated: false } }),
    /not in recipe bands/,
  );
});

test("a missing sourced input throws rather than defaulting", () => {
  const recipe: MetricRecipe = {
    op: "identity",
    unit: "count",
    sectionTitle: "X",
    headlineLabel: "Y",
    mechanismTemplate: "{result}",
    inputs: [{ key: "signups", label: "signups", min: 0, max: 100 }],
    maxFactor: 1,
    resultCeiling: 100,
  };
  assert.throws(() => evaluateRecipe(recipe, { values: {} }), /not sourced/);
});

test("a non-finite sourced input throws", () => {
  const recipe: MetricRecipe = {
    op: "identity",
    unit: "count",
    sectionTitle: "X",
    headlineLabel: "Y",
    mechanismTemplate: "{result}",
    inputs: [{ key: "n", label: "n", min: 0, max: 100 }],
    maxFactor: 1,
    resultCeiling: 100,
  };
  assert.throws(
    () => evaluateRecipe(recipe, { values: { n: sourced(Number.POSITIVE_INFINITY) } }),
    /finite number/,
  );
});

test("the result ceiling caps an inflated figure after clamps", () => {
  const recipe: MetricRecipe = {
    op: "sum",
    unit: "currency_usd",
    sectionTitle: "X",
    headlineLabel: "Y",
    mechanismTemplate: "{result}",
    inputs: [
      { key: "a", label: "a", min: 0, max: 1000000 },
      { key: "b", label: "b", min: 0, max: 1000000 },
    ],
    maxFactor: 1,
    resultCeiling: 500000,
  };
  assert.throws(
    () => evaluateRecipe(recipe, { values: { a: sourced(400000), b: sourced(400000) } }),
    /exceeds resultCeiling/,
  );
});

test("any estimated input drives the disclosure footnote and satisfies the contract", () => {
  const recipe: MetricRecipe = {
    op: "sum",
    unit: "currency_usd",
    sectionTitle: "What this saves",
    headlineLabel: "Annual saving",
    mechanismTemplate: "{result}",
    inputs: [
      { key: "a", label: "a", min: 0, max: 100000 },
      { key: "b", label: "b", min: 0, max: 100000 },
    ],
    maxFactor: 1,
    resultCeiling: 1000000,
  };
  const inputs: RecipeInputs = { values: { a: sourced(10000, false), b: sourced(20000, true) } };
  const out = evaluateRecipe(recipe, inputs);
  assert.ok(out.footnote, "an estimated input forces a footnote");
  assertValueModelContract(out, true);
});

test("an unknown op throws", () => {
  const recipe = {
    op: "exponentiate",
    unit: "count",
    sectionTitle: "X",
    headlineLabel: "Y",
    mechanismTemplate: "{result}",
    inputs: [],
    maxFactor: 1,
    resultCeiling: 100,
  } as unknown as MetricRecipe;
  assert.throws(() => evaluateRecipe(recipe, { values: {} }), /unknown recipe op/);
});
