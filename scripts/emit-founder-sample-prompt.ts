// Emit the GENUINE assembled Website Builder prompt for the founder-led customer-zero
// sample, with ZERO model calls (cost discipline: no live Research Agent, no live
// Website Builder). This runs the real code path the worker runs in buildSite:
// it resolves the founder_led_sales vertical, computes the value model
// deterministically, derives the brand tokens, and assembles DESIGN_BRIEF plus the
// per-lead user prompt. The output is the exact prompt the live builder would send,
// so the G2 grep and the G3 review score faithful generated copy, not a hand-faked
// stand-in.
//
// The sample lead is Devin Park, Co-Founder and CEO at Cedar, the customer-zero
// target after the reposition (D59), mirrored from scripts/run-pipeline-mirenta.ts.
// Run: node scripts/emit-founder-sample-prompt.ts > loop/samples/builder-prompt.txt

import {
  DESIGN_BRIEF,
  buildUserPrompt,
  type BuildSiteInput,
} from "../src/agents/builder-prompt.ts";
import {
  deriveTokens,
  renderTokenBlock,
  resolveLogoUrl,
  resolveFaviconHref,
  resolveGoogleFontHref,
} from "../src/agents/brand-tokens.ts";
import { getVertical } from "../src/verticals/index.ts";
import type { ProductProfile } from "../src/domain/entities.ts";
import type { ResearchObject } from "../src/domain/research.ts";

// Seller profile: Mirenta sells Mirenta, declaring the founder_led_sales vertical.
// Mirrors scripts/run-pipeline-mirenta.ts so the sample matches customer zero.
const profile: ProductProfile = {
  org_id: "sample-org",
  company_name: "Mirenta",
  product_name: "Mirenta",
  value_prop:
    "Mirenta turns a lead list into one hyper-personalized one-pager website per prospect, so every outbound touch opens with research the prospect recognizes as their own priorities",
  positioning:
    "The outbound personalization platform that researches each prospect and builds a prospect-facing one-pager that pitches in the prospect's own language",
  proof_points: [
    { claim: "One researched, brand-matched one-pager per lead, generated end to end" },
    { claim: "Every quote on the page is re-fetched and verified before it ships" },
  ],
  cta_text: "Book a working session",
  brand: { primary_color: "#3b5bdb" },
  vertical: "founder_led_sales",
  economics: null,
  created_at: "2026-06-21T00:00:00.000Z",
  updated_at: "2026-06-21T00:00:00.000Z",
};

const lead = {
  first_name: "Devin",
  last_name: "Park",
  role: "Co-Founder and CEO",
  company: "Cedar",
  website_url: "https://cedar.example",
};

// Research object as the founder-led Research Agent would emit it for Cedar: a
// founder-to-founder frame, self-description language and one lived moment for the
// hero, founder-scale value inputs in band, and estimated: true (reply rate and
// per-touch hours are private, so the model estimates them). No fabricated quote
// (the investor-quote bet lost the tournament); quotes stay empty, which the page
// handles by rendering none.
const research: ResearchObject = {
  vertical: "founder_led_sales",
  account: {
    summary:
      "Cedar is a seed-stage fintech building Cedar Cash, a banking and corporate-card product for early-stage founders. Devin Park and a founding team of three sell the product themselves, founder to founder, to the same pre-seed and seed founders Cedar serves. Cedar onboarded its first 40 design-partner companies through a Y Combinator W25 batch referral loop, where one founder introduces the next.",
    recent_moves: [
      "Raised a 4.5 million dollar seed round led by Basis Set Ventures in March 2026",
      "Shipped Cedar Cash to the first 40 design-partner companies out of the YC W25 batch",
      "Devin writes every outbound message by hand and runs the first sales calls personally, posting weekly build-in-public updates on the founder-led motion",
    ],
    self_description_language:
      "banking built by founders, for founders who are still doing everything themselves",
  },
  executives: [
    {
      name: "Devin Park",
      title: "Co-Founder and CEO",
      owns: "Product direction and the first sales conversations",
      profile:
        "Devin co-founded Cedar after waiting nineteen days to open a business bank account as a first-time founder, sold the first 40 design partners personally through warm YC introductions, and still writes every outbound message by hand while the team is three people.",
    },
  ],
  quotes: [],
  extension: {
    domains: ["Go-to-market", "Growth"],
    priorities: [
      {
        domain: "Go-to-market",
        pov: "Winning the first reference customers matters more than any growth tactic, because early founders buy banking from a name another founder trusts.",
        why_now:
          "The seed round bought a short runway to prove the product earns word of mouth before the next raise.",
      },
      {
        domain: "Growth",
        pov: "Devin's own hours are the scarce input: every hour spent hand-writing outbound is an hour not spent with design partners.",
        why_now:
          "The team is too small to hire a growth function, so the founder carries outbound personally right now.",
      },
    ],
    value_inputs: {
      team_size: 3,
      prospects_per_month: 40,
      avg_deal_value: 12000,
      baseline_reply_rate: 0.04,
      hours_per_personalized_touch: 1.0,
    },
    estimated: true,
  },
  brand: {
    primary_color: "#0e7490",
    accent_color: "#0f766e",
    background_color: "#f8fafc",
    text_color: "#0f172a",
  },
};

// Resolve the vertical and compute the value model deterministically, exactly as
// buildSite does. No model call.
const vertical = getVertical(profile.vertical);
const valueModel = vertical.createValueModel(profile);
const validatedInputs = valueModel.validateInputs(
  research.extension.value_inputs,
  research.extension.estimated,
);
const value = valueModel.compute(validatedInputs);

const input: BuildSiteInput = { lead, profile, research, vertical };

const tokens = deriveTokens(profile, research.brand, vertical.defaultAccentColor);
const tokenBlock = renderTokenBlock(tokens);
const logoUrl = resolveLogoUrl(profile, research.brand);
const faviconHref = resolveFaviconHref(lead.website_url, research.brand);
const fontHref = resolveGoogleFontHref(research.brand?.font_family);

const userPrompt = buildUserPrompt(input, value, {
  tokenBlock,
  logoUrl,
  faviconHref,
  fontHref,
  booking: null,
});

// Emit the full assembled prompt: the cache-stable system brief, then the per-lead
// user prompt. The Builder subagent renders the page from exactly this.
process.stdout.write("===== SYSTEM (DESIGN_BRIEF) =====\n");
process.stdout.write(DESIGN_BRIEF);
process.stdout.write("\n\n===== USER (per-lead prompt) =====\n");
process.stdout.write(userPrompt);
process.stdout.write("\n");
