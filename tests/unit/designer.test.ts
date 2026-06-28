import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildDesignerPrompt,
  normalizePageSpec,
  PageSpecSchemaError,
  type DesignerInput,
} from "../../src/agents/designer-prompt.ts";
import type { ResearchObject } from "../../src/domain/research.ts";
import type { MetricRecipe } from "../../src/domain/recipe.ts";

const research: ResearchObject = {
  account: {
    summary: "A seed-stage developer-tools startup.",
    recent_moves: ["Shipped a public beta.", "Raised a seed round."],
    self_description_language: "We build for builders.",
  },
  voices: [
    {
      name: "Jordan Reyes",
      identity: "the founder",
      tier: "self",
      quote: { text: "We ship every day.", source_url: "https://origami.chat/blog", verified: true },
    },
  ],
  extension: {
    domains: ["Growth", "Product"],
    priorities: [
      { domain: "Growth", pov: "Find the first repeatable channel.", why_now: "Runway is short." },
    ],
    recipe_inputs: { values: { tooling: { value: 12000, estimated: false } } },
    estimated: false,
  },
};

const recipe: MetricRecipe = {
  op: "identity",
  unit: "currency_usd",
  sectionTitle: "What this returns",
  headlineLabel: "Annual saving",
  mechanismTemplate: "Mirenta returns {result}.",
  inputs: [{ key: "tooling", label: "tooling spend", min: 0, max: 100000 }],
  maxFactor: 1,
  resultCeiling: 1000000,
};

const input: DesignerInput = {
  lead: { first_name: "Jordan", last_name: "Reyes", role: "Founder", company: "Origami" },
  profile: {
    company_name: "Mirenta",
    product_name: "Mirenta",
    value_prop: "Turns a lead list into one hyper-personalized one-pager per prospect.",
  },
  research,
  recipe,
};

function validSpec() {
  return {
    sections: [
      { id: "hero", kind: "hero", landmark: "banner", heading: "Built for Jordan at Origami", contentRefs: [] },
      { id: "growth", kind: "priorities", landmark: "region", heading: "Your next channel", contentRefs: ["Growth"] },
      { id: "the-return", kind: "value_render", landmark: "region", heading: "What this returns", contentRefs: ["value"] },
      { id: "book", kind: "cta", landmark: "region", heading: "Thirty minutes", contentRefs: [] },
    ],
    valueRenderSectionId: "the-return",
    ctaSectionId: "book",
    quickLinkTargets: ["the-return", "book"],
    artDirection: {
      name: "Terminal Editorial",
      typeTreatment: "Monospace headings over a serif body.",
      motifs: ["A hairline rule under each heading."],
    },
  };
}

test("builds a prompt grounded in the research and the recipe headings", () => {
  const prompt = buildDesignerPrompt(input);
  assert.match(prompt, /Jordan Reyes/);
  assert.match(prompt, /Origami/);
  assert.match(prompt, /seed-stage developer-tools startup/);
  assert.match(prompt, /Growth/);
  assert.match(prompt, /What this returns/);
  assert.match(prompt, /emit_page_spec exactly once/);
});

test("normalizes a well-formed spec and runs the well-formedness pass", () => {
  const spec = normalizePageSpec(validSpec());
  assert.equal(spec.sections.length, 4);
  assert.equal(spec.valueRenderSectionId, "the-return");
  assert.equal(spec.artDirection.name, "Terminal Editorial");
});

test("rejects a spec whose valueRenderSectionId does not point at a value_render", () => {
  const raw = validSpec();
  raw.valueRenderSectionId = "growth";
  assert.throws(() => normalizePageSpec(raw), PageSpecSchemaError);
});

test("rejects a spec with no banner landmark", () => {
  const raw = validSpec();
  raw.sections[0]!.landmark = "region";
  assert.throws(() => normalizePageSpec(raw), /exactly one banner/);
});

test("rejects a spec missing a cta section", () => {
  const raw = validSpec();
  raw.sections = raw.sections.filter((s) => s.kind !== "cta");
  raw.ctaSectionId = "the-return";
  assert.throws(() => normalizePageSpec(raw), PageSpecSchemaError);
});

test("rejects a non-kebab section id", () => {
  const raw = validSpec();
  raw.sections[1]!.id = "Growth Section";
  assert.throws(() => normalizePageSpec(raw), /kebab-case/);
});

test("rejects a quick-link target that does not resolve", () => {
  const raw = validSpec();
  raw.quickLinkTargets = ["nowhere"];
  assert.throws(() => normalizePageSpec(raw), PageSpecSchemaError);
});

test("rejects art direction missing a type treatment", () => {
  const raw = validSpec();
  (raw.artDirection as Record<string, unknown>).typeTreatment = "";
  assert.throws(() => normalizePageSpec(raw), PageSpecSchemaError);
});

test("rejects a non-object payload", () => {
  assert.throws(() => normalizePageSpec(null), /not an object/);
});

test("rejects malformed sections", () => {
  const raw = validSpec();
  (raw.sections[0] as Record<string, unknown>).heading = 42;
  assert.throws(() => normalizePageSpec(raw), /sections\[0\] malformed/);
});
