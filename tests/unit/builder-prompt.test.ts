import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildUserPrompt,
  renderValueBlock,
  type BuildSiteInput,
  type PromptAssets,
} from "../../src/agents/builder-prompt.ts";
import type { ValueResult } from "../../src/verticals/index.ts";
import type { ResearchObject } from "../../src/domain/research.ts";
import type { ProductProfile } from "../../src/domain/entities.ts";

const value: ValueResult = {
  sectionTitle: "What this frees up",
  headline: { label: "Founder time reclaimed", value: "~4 to 6 founder-hours reclaimed each week" },
  mechanism: "A seed-stage founder runs go-to-market by hand.",
  footnote: "Drawn from a stage-band benchmark.",
};

const research: ResearchObject = {
  vertical: "sales_marketing",
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
    value_inputs: {},
    context: { stage_band: "seed" },
    estimated: false,
  },
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
  vertical: "sales_marketing",
  economics: null,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
};

const input: BuildSiteInput = {
  lead: { first_name: "Angelo", last_name: "Rossi", role: "Founder", company: "Plexus Corp", website_url: "https://plexus.test" },
  profile,
  research,
  vertical: { defaultAccentColor: "#0176d3" } as BuildSiteInput["vertical"],
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

test("buildUserPrompt carries the resolved assets and required anchors", () => {
  const prompt = buildUserPrompt(input, value, assets);
  assert.ok(prompt.includes("https://cdn.test/logo.png"));
  assert.ok(prompt.includes("https://book.test/demo"));
  assert.ok(prompt.includes("https://fonts.googleapis.com/css2?family=Oswald&display=swap"));
  assert.ok(prompt.includes(":root{--brand:#0176d3;}"));
  assert.ok(prompt.includes('href="#business-case"'));
  assert.ok(prompt.includes('href="#book"'));
});

test("buildUserPrompt falls back to a wordmark and reply-to-email when assets are absent", () => {
  const bare: PromptAssets = { tokenBlock: ":root{}", booking: null };
  const prompt = buildUserPrompt(input, value, bare);
  assert.ok(/text wordmark/i.test(prompt));
  assert.ok(/reply to the outreach email/i.test(prompt));
});

test("renderValueBlock carries the mechanism and headline value without dashboard parts", () => {
  const block = renderValueBlock(value);
  assert.ok(block.includes("Mechanism:"));
  assert.ok(block.includes("~4 to 6 founder-hours reclaimed each week"));
  assert.ok(!block.includes("Scenario"));
  assert.ok(!block.includes("Metric tiles"));
  assert.ok(!block.includes("projection"));
});
