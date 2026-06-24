// Cost-free smoke for the Website Builder prompt. Spends no tokens: no model call.
// It assembles the EXACT prompt the builder runs for the customer-zero lead
// (Finn Mallery at Origami, Mirenta selling Mirenta on the founder_led_sales
// vertical) and prints it to stdout, so `pnpm smoke:builder | pbcopy` captures the
// prompt ready to paste into a fresh Claude Code session. The lead and seller
// mirror scripts/run-pipeline-mirenta.ts.
//
// This is the second half of the two-step smoke. Run `pnpm smoke:research` first,
// run that prompt in a Claude Code session, and have it write the research object
// to /tmp/mirenta-research.json (the research prompt instructs exactly that). This
// script reads that file and assembles the builder prompt over the REAL researched
// object, the same handoff the live pipeline makes (research -> builder). Override
// the path with MIRENTA_RESEARCH_JSON. Every research-derived field in the prompt
// (account, executives, quotes, priorities, value inputs, prospect brand) comes
// from that file, so the script hard fails when it is missing rather than smoke
// testing a hollow placeholder.

import { readFileSync } from "node:fs";
import {
  deriveTokens,
  renderTokenBlock,
  resolveLogoUrl,
  resolveFaviconHref,
  resolveGoogleFontHref,
} from "../src/agents/brand-tokens.ts";
import { DESIGN_BRIEF, buildUserPrompt } from "../src/agents/builder-prompt.ts";
import { founderLedSalesVertical } from "../src/verticals/founder-led-sales.ts";
import { validateResearch } from "../src/domain/research.ts";
import type { ProductProfile } from "../src/domain/entities.ts";

const vertical = founderLedSalesVertical;
const RESEARCH_JSON_PATH =
  process.env.MIRENTA_RESEARCH_JSON ?? "/tmp/mirenta-research.json";

// Construct the sample ProductProfile: Mirenta sells Mirenta on the
// founder_led_sales vertical. Mirrors scripts/run-pipeline-mirenta.ts.
const sampleProfile: ProductProfile = {
  org_id: "00000000-0000-0000-0000-000000000000",
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
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

// Sample lead.
const sampleLead = {
  first_name: "Finn",
  last_name: "Mallery",
  role: "Co-Founder and CEO",
  company: "Origami",
  website_url: "https://origami.chat/",
};

// Resolve the booking target for the CTA exactly as builder.ts does: prefer a
// seller-supplied scheduling URL, else null so the CTA falls back to reply-to-email.
function bookingUrl(profile: ProductProfile): string | null {
  const link = profile.brand?.["cta_url"];
  return typeof link === "string" && /^https?:\/\//.test(link) ? link : null;
}

// Load the researched object the research step produced, validated through the
// same schema the worker runs (validateResearch). Hard fail when the file is
// missing: the builder prompt is only meaningful over a real research object.
// Diagnostics go to stderr so stdout stays a clean prompt for `| pbcopy`.
let raw: string;
try {
  raw = readFileSync(RESEARCH_JSON_PATH, "utf8");
} catch {
  process.stderr.write(
    `[smoke:builder] ${RESEARCH_JSON_PATH} not found. Run \`pnpm smoke:research\`, run that prompt in a Claude Code session, and write its research object to ${RESEARCH_JSON_PATH} (or set MIRENTA_RESEARCH_JSON) before running this.\n`,
  );
  process.exit(1);
}
let research;
try {
  research = validateResearch(JSON.parse(raw), vertical);
} catch (e) {
  process.stderr.write(
    `[smoke:builder] ${RESEARCH_JSON_PATH} does not match the research contract: ${(e as Error).message}. Re-run \`pnpm smoke:research\` and follow its output schema exactly.\n`,
  );
  process.exit(1);
}
process.stderr.write(`[smoke:builder] loaded research from ${RESEARCH_JSON_PATH}\n`);

// Assemble the prompt with no model call, mirroring buildSite step for step, then
// print the system brief and per-lead user message to stdout.
const valueModel = vertical.createValueModel(sampleProfile);
const validatedInputs = valueModel.validateInputs(
  research.extension.value_inputs,
  research.extension.estimated,
);
const value = valueModel.compute(validatedInputs);

const brand = research.brand;
const tokens = deriveTokens(sampleProfile, brand, vertical.defaultAccentColor);
const tokenBlock = renderTokenBlock(tokens);
const logoUrl = resolveLogoUrl(sampleProfile, brand);
const faviconHref = resolveFaviconHref(sampleLead.website_url, brand);
const fontHref = resolveGoogleFontHref(brand?.font_family);
const booking = bookingUrl(sampleProfile);

const userPrompt = buildUserPrompt(
  { lead: sampleLead, profile: sampleProfile, research, vertical },
  value,
  { tokenBlock, logoUrl, faviconHref, fontHref, booking },
);

process.stdout.write(`${DESIGN_BRIEF}\n\n${userPrompt}\n`);
