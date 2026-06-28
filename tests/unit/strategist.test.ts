import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildStrategistPrompt,
  validateStrategy,
  StrategySchemaError,
  type StrategistInput,
} from "../../src/agents/strategist-prompt.ts";
import { evaluateRecipe } from "../../src/domain/recipe.ts";

const input: StrategistInput = {
  lead: {
    first_name: "Jordan",
    last_name: "Reyes",
    role: "Founder & CEO",
    company: "Origami",
    website_url: "https://origami.chat",
  },
  profile: {
    company_name: "Mirenta",
    product_name: "Mirenta",
    value_prop: "Turns a lead list into one hyper-personalized one-pager per prospect.",
  },
};

function validSumStrategy() {
  return {
    plan: {
      domains: ["Growth", "Product"],
      voiceTargeting: "Hunt Jordan's own launch posts, then the seed backer, then a revered founder voice.",
      inputSourcing: "Read the raise announcement and the public pricing page for the spend figures.",
    },
    recipe: {
      op: "sum",
      unit: "currency_usd",
      sectionTitle: "What this returns",
      headlineLabel: "Annual saving",
      mechanismTemplate: "Mirenta returns {result} by folding {input.tooling} and {input.contractors} into one pass.",
      inputs: [
        { key: "tooling", label: "tooling spend", min: 0, max: 100000 },
        { key: "contractors", label: "contractor spend", min: 0, max: 500000 },
      ],
      maxFactor: 1,
      resultCeiling: 1000000,
    },
  };
}

test("builds a prompt naming the lead, role, company, and seller product", () => {
  const prompt = buildStrategistPrompt(input);
  assert.match(prompt, /Jordan Reyes/);
  assert.match(prompt, /Founder & CEO/);
  assert.match(prompt, /Origami/);
  assert.match(prompt, /Mirenta/);
  assert.match(prompt, /origami\.chat/);
  assert.match(prompt, /emit_strategy exactly once/);
});

test("notes a missing website rather than rendering an empty string", () => {
  const prompt = buildStrategistPrompt({
    ...input,
    lead: { ...input.lead, website_url: null },
  });
  assert.match(prompt, /no website provided/);
});

test("validates a well-formed sum strategy and round-trips through evaluateRecipe", () => {
  const strategy = validateStrategy(validSumStrategy());
  assert.equal(strategy.recipe.op, "sum");
  assert.equal(strategy.plan.domains.length, 2);
  // The recipe the strategist emits must evaluate against sourced inputs without
  // throwing, so the build stage never receives a recipe it cannot compute.
  const value = evaluateRecipe(strategy.recipe, {
    values: {
      tooling: { value: 12000, estimated: false },
      contractors: { value: 48000, estimated: false },
    },
  });
  assert.equal(value.headline.value, "$60,000 per year");
});

test("validates a qualitative identity strategy and round-trips", () => {
  const raw = validSumStrategy();
  raw.recipe = {
    op: "identity",
    unit: "qualitative",
    sectionTitle: "The point of view",
    headlineLabel: "Why now",
    mechanismTemplate: "{result}",
    inputs: [],
    maxFactor: 1,
    resultCeiling: 1,
    literalValue: "One page that reads as written for Jordan, not generated.",
  } as typeof raw.recipe;
  const strategy = validateStrategy(raw);
  const value = evaluateRecipe(strategy.recipe, { values: {} });
  assert.equal(value.headline.value, "One page that reads as written for Jordan, not generated.");
});

test("validates a range_from_band strategy and round-trips", () => {
  const raw = validSumStrategy();
  raw.recipe = {
    op: "range_from_band",
    unit: "hours_per_week",
    sectionTitle: "What this frees up",
    headlineLabel: "Founder hours reclaimed",
    mechanismTemplate: "Mirenta reclaims {result}.",
    inputs: [],
    maxFactor: 1,
    resultCeiling: 168,
    bands: [{ name: "seed", low: 4, high: 6 }],
  } as typeof raw.recipe;
  const strategy = validateStrategy(raw);
  const value = evaluateRecipe(strategy.recipe, {
    values: {},
    band: { name: "seed", estimated: true },
  });
  assert.match(value.headline.value, /4 to 6 hours each week/);
  assert.ok(value.footnote);
});

test("rejects a ratio strategy missing its denominator key", () => {
  const raw = validSumStrategy();
  raw.recipe = {
    op: "ratio",
    unit: "currency_usd",
    sectionTitle: "Cost per lead",
    headlineLabel: "Per-lead cost",
    mechanismTemplate: "{result}",
    inputs: [{ key: "spend", label: "spend", min: 0, max: 100000 }],
    maxFactor: 1,
    resultCeiling: 100000,
    numeratorKey: "spend",
  } as typeof raw.recipe;
  assert.throws(() => validateStrategy(raw), StrategySchemaError);
});

test("rejects a qualitative recipe with no literalValue", () => {
  const raw = validSumStrategy();
  raw.recipe = {
    op: "identity",
    unit: "qualitative",
    sectionTitle: "POV",
    headlineLabel: "Why now",
    mechanismTemplate: "{result}",
    inputs: [],
    maxFactor: 1,
    resultCeiling: 1,
  } as typeof raw.recipe;
  assert.throws(() => validateStrategy(raw), /literalValue/);
});

test("rejects an unknown op", () => {
  const raw = validSumStrategy();
  (raw.recipe as Record<string, unknown>).op = "exponentiate";
  assert.throws(() => validateStrategy(raw), /op invalid/);
});

test("rejects an empty domains plan", () => {
  const raw = validSumStrategy();
  raw.plan.domains = [];
  assert.throws(() => validateStrategy(raw), /plan malformed/);
});

test("rejects a non-object payload", () => {
  assert.throws(() => validateStrategy(null), /not an object/);
});

test("rejects a recipe missing the result ceiling", () => {
  const raw = validSumStrategy();
  delete (raw.recipe as Record<string, unknown>).resultCeiling;
  assert.throws(() => validateStrategy(raw), /maxFactor and resultCeiling/);
});
