// Unit tests for the pure prompt builder (builder-prompt.ts). The module carries
// no config import, so these tests run without the API client or env. They pin the
// two contracts the validator depends on downstream: the prompt serializes ONLY
// verified quotes, and it carries every precomputed value figure verbatim as the
// exact display strings the validator later confirms on the page.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildUserPrompt, DESIGN_BRIEF, type BuildSiteInput, type PromptAssets } from "../../src/agents/builder-prompt.ts";
import type { ValueResult } from "../../src/verticals/index.ts";
import type { ResearchObject } from "../../src/domain/research.ts";
import type { ProductProfile } from "../../src/domain/entities.ts";

const value: ValueResult = {
  sectionTitle: "Business Value",
  headline: { label: "Expected net annual savings", value: "$2.6M" },
  scenarios: [
    { name: "Conservative", primaryValue: "$1.6M", primaryLabel: "Net Annual Savings", secondary: "97% ROI" },
    { name: "Expected", primaryValue: "$2.6M", primaryLabel: "Net Annual Savings", secondary: "156% ROI" },
    { name: "Aggressive", primaryValue: "$3.7M", primaryLabel: "Net Annual Savings", secondary: "218% ROI" },
  ],
  metrics: [
    { label: "Expected ROI", value: "156%" },
    { label: "Payback period", value: "4.9 mo" },
    { label: "5-year net savings", value: "$10.1M" },
    { label: "NPV at 8 percent", value: "$7.8M" },
  ],
  projection: {
    label: "Cumulative net cash flow",
    unit: "USD",
    series: [
      { period: "Year 1", value: 374000, display: "$374K" },
      { period: "Year 2", value: 2192400, display: "$2.2M" },
      { period: "Year 3", value: 4840400, display: "$4.8M" },
      { period: "Year 4", value: 7488400, display: "$7.5M" },
      { period: "Year 5", value: 10136400, display: "$10.1M" },
    ],
  },
  footnote: "Figures model industry benchmarks.",
};

const research: ResearchObject = {
  vertical: "salesforce_employee_service",
  account: { summary: "An electronics firm.", recent_moves: ["Expanded automation"], self_description_language: "We build." },
  executives: [{ name: "Jordan Lee", title: "CIO", owns: "IT", profile: "Leads IT." }],
  quotes: [
    { text: "We invest in our people every single day without fail.", speaker: "CEO", source_url: "https://x.test/a", verified: true },
    { text: "This unverified rumor must never reach the prompt at all.", speaker: "Rumor", source_url: "https://x.test/b", verified: false },
  ],
  extension: {
    domains: ["HR"],
    priorities: [{ domain: "HR", pov: "Scale service.", why_now: "Growing fast." }],
    value_inputs: { total_employees: 20000 },
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
  cta_text: "Schedule a demo",
  brand: { primary_color: "#0176d3" },
  vertical: "salesforce_employee_service",
  economics: null,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
};

const input: BuildSiteInput = {
  lead: { first_name: "Angelo", last_name: "Rossi", role: "CIO", company: "Plexus Corp", website_url: "https://plexus.test" },
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

test("buildUserPrompt serializes only verified quotes", () => {
  const prompt = buildUserPrompt(input, value, assets);
  assert.ok(prompt.includes("We invest in our people every single day without fail."));
  assert.ok(!prompt.includes("This unverified rumor must never reach the prompt at all."));
});

test("buildUserPrompt carries every value figure verbatim", () => {
  const prompt = buildUserPrompt(input, value, assets);
  const figures = [
    "$2.6M",
    "$1.6M", "97% ROI",
    "156% ROI", "218% ROI",
    "156%", "4.9 mo", "$10.1M", "$7.8M",
    "$374K", "$2.2M", "$4.8M", "$7.5M",
  ];
  for (const fig of figures) {
    assert.ok(prompt.includes(fig), `prompt should carry the figure ${fig}`);
  }
});

test("buildUserPrompt serializes a precomputed height fraction per projection point", () => {
  // The chart geometry is precomputed so the cheap builder never invents its own
  // pixel scale (which overflowed the plot in the G3 sample). Each point carries a
  // fraction in [0,1]: its share of the tallest bar. The tallest point ($10.1M)
  // gets 1.00 and the smallest ($374K) gets 374000/10136400 = 0.04.
  const prompt = buildUserPrompt(input, value, assets);
  assert.match(prompt, /height fraction in \[0,1\]/);
  assert.ok(prompt.includes('Year 5: height fraction 1.00, display "$10.1M"'));
  assert.ok(prompt.includes('Year 1: height fraction 0.04, display "$374K"'));
  // The brief instructs anchoring every bar to one baseline, the fix for overflow.
  assert.match(DESIGN_BRIEF, /anchor every bar to one shared baseline/);
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

test("buildUserPrompt injects the vertical hero narrative when the spec carries one", () => {
  const withNarrative: BuildSiteInput = {
    ...input,
    vertical: {
      defaultAccentColor: "#0f766e",
      narrativeGuidance: "HERO NARRATIVE (founder-to-founder). Open with a mirror line.",
    } as BuildSiteInput["vertical"],
  };
  const prompt = buildUserPrompt(withNarrative, value, assets);
  assert.ok(prompt.includes("HERO NARRATIVE (founder-to-founder)"));
  // The narrative sits ahead of the business case so the hero context precedes the figures.
  assert.ok(prompt.indexOf("HERO NARRATIVE") < prompt.indexOf("BUSINESS CASE"));
});

test("buildUserPrompt omits the hero narrative cleanly when the spec carries none", () => {
  // The default input vertical carries only defaultAccentColor, no narrativeGuidance.
  const prompt = buildUserPrompt(input, value, assets);
  assert.ok(!prompt.includes("HERO NARRATIVE"));
});
