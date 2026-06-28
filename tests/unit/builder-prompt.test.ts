import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildUserPrompt,
  renderValueBlock,
  renderSpecBlock,
  DESIGN_BRIEF,
  type BuildSiteInput,
  type PromptAssets,
} from "../../src/agents/builder-prompt.ts";
import type { ValueResult } from "../../src/domain/value-contract.ts";
import type { ResearchObject } from "../../src/domain/research.ts";
import type { MetricRecipe } from "../../src/domain/recipe.ts";
import type { PageSpec } from "../../src/domain/page-spec.ts";
import type { ProductProfile } from "../../src/domain/entities.ts";

const value: ValueResult = {
  sectionTitle: "What this frees up",
  headline: { label: "Founder time reclaimed", value: "~4 to 6 founder-hours reclaimed each week" },
  mechanism: "A seed-stage founder runs go-to-market by hand.",
  breakdown: [
    { label: "weekly pitches", value: "8", estimated: false },
    { label: "hours per pitch", value: "2", estimated: true },
  ],
  footnote: "Drawn from a stage-band benchmark.",
};

const research: ResearchObject = {
  account: { summary: "A seed-stage startup.", recent_moves: ["Closed a seed round"], self_description_language: "We build." },
  voices: [
    {
      name: "Jordan Lee",
      identity: "the founder",
      tier: "self",
      quote: { text: "We invest in our people every single day without fail.", source_url: "https://x.test/a", verified: true },
    },
    {
      name: "Rumor Mill",
      identity: "a blog",
      tier: "tribe",
      quote: { text: "This unverified rumor must never reach the prompt at all.", source_url: "https://x.test/b", verified: false },
    },
  ],
  extension: {
    domains: ["Sales", "Marketing"],
    priorities: [{ domain: "Sales", pov: "Find the first repeatable channel.", why_now: "Runway is finite." }],
    recipe_inputs: { values: {}, band: { name: "seed", estimated: true } },
    estimated: true,
  },
};

const recipe: MetricRecipe = {
  op: "range_from_band",
  unit: "hours_per_week",
  sectionTitle: "What this frees up",
  headlineLabel: "Founder time reclaimed",
  mechanismTemplate: "Mirenta reclaims {result}.",
  inputs: [],
  maxFactor: 1,
  resultCeiling: 168,
  bands: [{ name: "seed", low: 4, high: 6 }],
};

const spec: PageSpec = {
  sections: [
    { id: "hero", kind: "hero", landmark: "banner", heading: "Built for Angelo at Plexus", contentRefs: [] },
    { id: "channels", kind: "priorities", landmark: "region", heading: "Your next channel", contentRefs: ["Sales"] },
    { id: "the-hours", kind: "value_render", landmark: "region", heading: "What this frees up", contentRefs: ["value"] },
    { id: "lets-talk", kind: "cta", landmark: "region", heading: "Thirty minutes", contentRefs: [] },
    { id: "fine-print", kind: "footer", landmark: "contentinfo", heading: "A note on the figures", contentRefs: [] },
  ],
  valueRenderSectionId: "the-hours",
  ctaSectionId: "lets-talk",
  quickLinkTargets: ["the-hours", "lets-talk"],
  artDirection: { name: "Terminal Editorial", signatureElement: "A monospace command-line motif framing the hero heading.", typeTreatment: "Monospace headings over a serif body.", motifs: ["A hairline rule under each heading."] },
};

const profile: ProductProfile = {
  org_id: "00000000-0000-0000-0000-000000000000",
  company_name: "Salesforce",
  product_name: "Agentforce",
  value_prop: "AI employee support at scale.",
  positioning: "Self-service at scale.",
  proof_points: [],
  cta_text: "Trade notes founder to founder",
  brand: { primary_color: "#0176d3" },
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
};

const input: BuildSiteInput = {
  lead: { first_name: "Angelo", last_name: "Rossi", role: "Founder", company: "Plexus Corp", website_url: "https://plexus.test" },
  profile,
  research,
  recipe,
  spec,
};

const assets: PromptAssets = {
  tokenBlock: ":root{--brand:#0176d3;}",
  logoUrl: "https://cdn.test/logo.png",
  faviconHref: "https://plexus.test/favicon.ico",
  fontHref: "https://fonts.googleapis.com/css2?family=Oswald&display=swap",
  booking: "https://book.test/demo",
};

test("buildUserPrompt serializes only verified voice quotes", () => {
  const prompt = buildUserPrompt(input, value, assets);
  assert.ok(prompt.includes("We invest in our people every single day without fail."));
  assert.ok(!prompt.includes("This unverified rumor must never reach the prompt at all."));
});

test("buildUserPrompt carries the headline value and mechanism verbatim", () => {
  const prompt = buildUserPrompt(input, value, assets);
  assert.ok(prompt.includes("~4 to 6 founder-hours reclaimed each week"));
  assert.ok(prompt.includes("A seed-stage founder runs go-to-market by hand."));
});

test("buildUserPrompt tags the voice by tier and identity", () => {
  const prompt = buildUserPrompt(input, value, assets);
  assert.ok(prompt.includes("Jordan Lee"));
  assert.ok(prompt.includes("the founder"));
  assert.ok(prompt.includes("self"));
});

test("buildUserPrompt carries the resolved assets and the spec quick-links", () => {
  const prompt = buildUserPrompt(input, value, assets);
  assert.ok(prompt.includes("https://cdn.test/logo.png"));
  assert.ok(prompt.includes("https://book.test/demo"));
  assert.ok(prompt.includes("https://fonts.googleapis.com/css2?family=Oswald&display=swap"));
  assert.ok(prompt.includes(":root{--brand:#0176d3;}"));
  assert.ok(prompt.includes('href="#the-hours"'));
  assert.ok(prompt.includes('href="#lets-talk"'));
});

test("buildUserPrompt renders the bespoke section list, ids, and art direction", () => {
  const prompt = buildUserPrompt(input, value, assets);
  for (const id of ["hero", "channels", "the-hours", "lets-talk", "fine-print"]) {
    assert.ok(prompt.includes(`id="${id}"`), `missing section id ${id}`);
  }
  assert.ok(prompt.includes("Terminal Editorial"));
  assert.ok(prompt.includes("Monospace headings over a serif body."));
  assert.ok(prompt.includes("A hairline rule under each heading."));
});

test("buildUserPrompt falls back to a wordmark and reply-to-email when assets are absent", () => {
  const bare: PromptAssets = { tokenBlock: ":root{}", booking: null };
  const prompt = buildUserPrompt(input, value, bare);
  assert.ok(/text wordmark/i.test(prompt));
  assert.ok(/reply to the outreach email/i.test(prompt));
});

test("renderSpecBlock names the value-render and cta sections", () => {
  const block = renderSpecBlock(spec);
  assert.ok(block.includes('VALUE-RENDER SECTION: id="the-hours"'));
  assert.ok(block.includes('CTA SECTION: id="lets-talk"'));
  assert.ok(/SIGNATURE ELEMENT/.test(block));
  assert.ok(block.includes("A monospace command-line motif framing the hero heading."));
});

test("DESIGN_BRIEF drives off the bespoke spec and keeps the anti-AI-copy rules", () => {
  assert.ok(/page spec/i.test(DESIGN_BRIEF));
  assert.ok(/art direction/i.test(DESIGN_BRIEF));
  assert.ok(/render every listed section/i.test(DESIGN_BRIEF));
  assert.ok(/tricolon/i.test(DESIGN_BRIEF));
  assert.ok(/vary sentence length/i.test(DESIGN_BRIEF));
});

test("DESIGN_BRIEF demands one signature element with restraint, not stacked devices", () => {
  assert.ok(/signature element/i.test(DESIGN_BRIEF));
  // The brief must warn off the alternating-grounds-as-only-mechanism default.
  assert.ok(/alternating/i.test(DESIGN_BRIEF));
});

test("DESIGN_BRIEF keeps subordinate headings quiet so the signature stays singular", () => {
  // A row of loud brand-colored display headings (the card-heading defect) competes
  // with the signature, so the brief must demand restrained subordinate headings.
  assert.ok(/subordinate headings quiet/i.test(DESIGN_BRIEF));
  assert.ok(/card and section headings/i.test(DESIGN_BRIEF));
});

test("DESIGN_BRIEF advertises the widened token variables", () => {
  assert.ok(DESIGN_BRIEF.includes("--surface-elevated"));
  assert.ok(DESIGN_BRIEF.includes("--shadow"));
});

test("renderValueBlock carries the mechanism and headline value without dashboard parts", () => {
  const block = renderValueBlock(value);
  assert.ok(block.includes("Mechanism:"));
  assert.ok(block.includes("~4 to 6 founder-hours reclaimed each week"));
  assert.ok(!block.includes("Scenario"));
  assert.ok(!block.includes("Metric tiles"));
  assert.ok(!block.includes("projection"));
});
