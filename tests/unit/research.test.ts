import { test } from "node:test";
import assert from "node:assert/strict";
import { validateResearch } from "../../src/domain/research.ts";
import type { MetricRecipe } from "../../src/domain/recipe.ts";

// A recipe that names two numeric inputs, so validateResearch checks both arrive.
const sumRecipe: MetricRecipe = {
  op: "sum",
  unit: "currency_usd",
  sectionTitle: "What this saves",
  headlineLabel: "Annual saving",
  mechanismTemplate: "{result}",
  inputs: [
    { key: "tools", label: "tooling spend", min: 0, max: 100000 },
    { key: "contractors", label: "contractor spend", min: 0, max: 500000 },
  ],
  maxFactor: 1,
  resultCeiling: 1000000,
};

// A band recipe, so validateResearch requires a sourced band.
const bandRecipe: MetricRecipe = {
  op: "range_from_band",
  unit: "hours_per_week",
  sectionTitle: "What this frees up",
  headlineLabel: "Founder time reclaimed",
  mechanismTemplate: "{result}",
  inputs: [],
  maxFactor: 1,
  resultCeiling: 168,
  bands: [{ name: "seed", low: 4, high: 6 }],
};

function validPayload() {
  return {
    account: {
      summary: "An early-stage startup.",
      recent_moves: ["Raised a seed round."],
      self_description_language: "We build for founders.",
    },
    voices: [
      {
        name: "Founder",
        identity: "the founder",
        tier: "self",
        quote: { text: "We move fast.", source_url: "https://example.com/a", verified: true },
      },
    ],
    extension: {
      domains: ["Sales", "Marketing"],
      priorities: [{ domain: "Sales", pov: "Find the first channel.", why_now: "Runway is short." }],
      recipe_inputs: {
        values: {
          tools: { value: 12000, estimated: false },
          contractors: { value: 48000, estimated: true },
        },
      },
      estimated: false,
    },
  };
}

test("accepts a well-formed payload and ORs the estimated flag", () => {
  const r = validateResearch(validPayload(), sumRecipe);
  assert.equal(r.voices.length, 1);
  assert.equal(r.voices[0]!.tier, "self");
  assert.equal(r.extension.recipe_inputs.values.tools!.value, 12000);
  // contractors was estimated, so the OR'd flag is true.
  assert.equal(r.extension.estimated, true);
});

test("coerces a non-boolean verified flag to false", () => {
  const p = validPayload();
  (p.voices[0]!.quote as Record<string, unknown>).verified = "yes";
  const r = validateResearch(p, sumRecipe);
  assert.equal(r.voices[0]!.quote.verified, false);
});

test("drops a recipe input value that is not a finite number, surfacing as missing", () => {
  const p = validPayload();
  (p.extension.recipe_inputs.values as Record<string, unknown>).tools = { value: "lots", estimated: false };
  assert.throws(() => validateResearch(p, sumRecipe), /missing recipe input: tools/);
});

test("rejects a payload missing a numeric input the recipe names", () => {
  const p = validPayload();
  delete (p.extension.recipe_inputs.values as Record<string, unknown>).contractors;
  assert.throws(() => validateResearch(p, sumRecipe), /missing recipe input: contractors/);
});

test("requires a sourced band for a range_from_band recipe", () => {
  const p = validPayload();
  p.extension.recipe_inputs = { values: {} } as typeof p.extension.recipe_inputs;
  assert.throws(() => validateResearch(p, bandRecipe), /band missing for a range_from_band/);
});

test("accepts a band recipe with a sourced band and ORs its estimated flag", () => {
  const p = validPayload();
  (p.extension.recipe_inputs as Record<string, unknown>) = {
    values: {},
    band: { name: "seed", estimated: true },
  };
  const r = validateResearch(p, bandRecipe);
  assert.equal(r.extension.recipe_inputs.band?.name, "seed");
  assert.equal(r.extension.estimated, true);
});

test("rejects a missing account summary", () => {
  const p = validPayload();
  delete (p.account as Record<string, unknown>).summary;
  assert.throws(() => validateResearch(p, sumRecipe), /account\.summary/);
});

test("rejects a malformed voice", () => {
  const p = validPayload();
  (p.voices[0] as Record<string, unknown>).tier = 42;
  assert.throws(() => validateResearch(p, sumRecipe), /voices\[0\]/);
});

test("an empty voices array passes", () => {
  const p = validPayload();
  p.voices = [];
  const r = validateResearch(p, sumRecipe);
  assert.equal(r.voices.length, 0);
});

test("rejects a non-object payload", () => {
  assert.throws(() => validateResearch(null, sumRecipe), /not an object/);
  assert.throws(() => validateResearch("nope", sumRecipe), /not an object/);
});

test("omits brand when absent", () => {
  const r = validateResearch(validPayload(), sumRecipe);
  assert.equal(r.brand, undefined);
});

test("passes through a well-formed brand and drops invalid fields", () => {
  const p = validPayload();
  (p as Record<string, unknown>).brand = {
    primary_color: "#1A2B3C",
    accent_color: "red", // not hex, dropped
    font_family: "Inter",
    logo_url: "http://acme.example/logo.png", // not https, dropped
    favicon_url: "https://acme.example/favicon.ico",
  };
  const r = validateResearch(p, sumRecipe);
  assert.equal(r.brand?.primary_color, "#1A2B3C");
  assert.equal(r.brand?.accent_color, undefined);
  assert.equal(r.brand?.logo_url, undefined);
  assert.equal(r.brand?.favicon_url, "https://acme.example/favicon.ico");
});

test("a malformed brand does not fail the whole object", () => {
  const p = validPayload();
  (p as Record<string, unknown>).brand = "not an object";
  const r = validateResearch(p, sumRecipe);
  assert.equal(r.brand, undefined);
  assert.equal(r.voices.length, 1);
});
