// Delivers the builder prompt so a human can paste it into a Claude Code session
// and generate the page by hand. This makes NO live API call. It reads the
// research object the research smoke produced (/tmp/mirenta-research.json) and
// falls back to a bundled founder sample when that file is absent.
//
// stdout carries ONLY the prompt, so it pipes clean:
//   npm run --silent smoke:builder | pbcopy
// On macOS the prompt also copies to the clipboard automatically. Diagnostics
// and wiring checks print to stderr, so they never pollute the copied text.
import { spawnSync } from "node:child_process";
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
import { validateResearch } from "../src/domain/research.ts";
import { getVertical } from "../src/verticals/index.ts";
import type { VerticalSpec } from "../src/verticals/index.ts";
import type { ResearchObject } from "../src/domain/research.ts";
import type { ProductProfile } from "../src/domain/entities.ts";
import { readFileSync } from "node:fs";

// Keep in sync with smoke-research.ts.
const RESEARCH_IN = "/tmp/mirenta-research.json";

// The vertical the bundled sample declares; the file path resolves its own.
const defaultVertical = getVertical("sales_marketing");

// A founder-model sample for sales_marketing: respected voices across the
// ladder, a stage band in context, no numeric value_inputs. Used when the
// research smoke output is not on disk.
const sampleResearch: ResearchObject = {
  vertical: "sales_marketing",
  account: {
    summary:
      "Origami builds a go-to-market tool that founders use to run outbound before they hire a sales team. The company shipped its first release this year and grows through founder word of mouth.",
    recent_moves: [
      "Announced a seed round led by a founder-focused fund",
      "Launched a self-serve onboarding flow for founder-led outbound",
      "Published a public roadmap",
    ],
    self_description_language:
      "Origami describes itself as the outbound engine for founders who sell before they hire.",
  },
  voices: [
    {
      name: "Finn Mallery",
      identity: "the co-founder and CEO",
      tier: "self",
      quote: {
        text: "I write every outbound email myself, because no one else knows why this matters yet.",
        source_url: "https://www.origami.com/blog/founder-selling",
        verified: true,
      },
    },
    {
      name: "Mara Delgado",
      identity: "Partner at Foundry Seed, who led the round",
      tier: "backer",
      quote: {
        text: "The founders who win early sell the vision in their own voice before they hire a single rep.",
        source_url: "https://foundryseed.com/notes/founder-led-sales",
        verified: true,
      },
    },
  ],
  extension: {
    domains: ["Sales", "Marketing"],
    priorities: [
      {
        domain: "Sales",
        pov: "Origami needs a repeatable outbound channel the founder runs without a hire.",
        why_now: "Runway is finite and the seed round buys a fixed number of months to find product-market fit.",
      },
      {
        domain: "Marketing",
        pov: "The founder writes the messaging that earns the first replies, so every hour spent there is an hour off the product.",
        why_now: "Early traction depends on the founder's own voice, which does not scale by hiring.",
      },
    ],
    value_inputs: {},
    context: { stage_band: "seed" },
    estimated: true,
  },
  brand: {
    primary_color: "#1f6feb",
    accent_color: "#8957e5",
    font_family: "Inter",
    logo_url: "https://www.origami.com/logo.svg",
    favicon_url: "https://www.origami.com/favicon.ico",
  },
};

const sampleProfile: ProductProfile = {
  org_id: "00000000-0000-0000-0000-000000000000",
  company_name: "Mirenta",
  product_name: "Mirenta",
  value_prop:
    "Turns a lead list into one hyper-personalized one-pager per founder, in their own language.",
  positioning: "Founder-to-founder outreach that reads the prospect's public trail and mirrors it back.",
  proof_points: [],
  cta_text: "Trade notes founder to founder",
  brand: { primary_color: "#1f6feb" },
  vertical: "sales_marketing",
  economics: null,
  created_at: new Date(0).toISOString(),
  updated_at: new Date(0).toISOString(),
};

const sampleLead = {
  first_name: "Finn",
  last_name: "Mallery",
  role: "Co-founder and CEO",
  company: "Origami",
  website_url: "https://www.origami.com",
};

// Read the research exactly as the worker's build stage does: resolve the
// vertical from the payload's own `vertical` field through getVertical, then
// validate through validateResearch. The fallback to the bundled sample fires
// ONLY when the file is absent. A present-but-invalid file fails loud, the same
// way a malformed research row fails the worker permanently, so the smoke never
// papers over output that would not survive production.
function loadResearch(): { research: ResearchObject; vertical: VerticalSpec; source: string } {
  let text: string;
  try {
    text = readFileSync(RESEARCH_IN, "utf8");
  } catch {
    return {
      research: sampleResearch,
      vertical: defaultVertical,
      source: "bundled founder sample (no file at " + RESEARCH_IN + ")",
    };
  }

  const raw = JSON.parse(text) as unknown;
  const verticalId =
    typeof raw === "object" && raw !== null && typeof (raw as { vertical?: unknown }).vertical === "string"
      ? (raw as { vertical: string }).vertical
      : defaultVertical.id;
  const vertical = getVertical(verticalId);
  const research = validateResearch(raw, vertical);
  return { research, vertical, source: RESEARCH_IN };
}

function copyToClipboard(text: string): boolean {
  try {
    return spawnSync("pbcopy", { input: text }).status === 0;
  } catch {
    return false;
  }
}

const log = (line = ""): void => {
  process.stderr.write(`${line}\n`);
};

try {
  const { research, vertical, source } = loadResearch();

  // Compute the value model exactly as buildSite does, threading context.
  const valueModel = vertical.createValueModel(sampleProfile);
  const validatedInputs = valueModel.validateInputs(
    research.extension.value_inputs,
    research.extension.estimated,
    research.extension.context,
  );
  const value = valueModel.compute(validatedInputs);

  // Resolve assets the same way the builder does.
  const tokens = deriveTokens(sampleProfile, research.brand, vertical.defaultAccentColor);
  const tokenBlock = renderTokenBlock(tokens);
  const logoUrl = resolveLogoUrl(sampleProfile, research.brand);
  const faviconHref = resolveFaviconHref(sampleLead.website_url, research.brand);
  const fontHref = resolveGoogleFontHref(research.brand?.font_family);

  const input: BuildSiteInput = {
    lead: sampleLead,
    profile: sampleProfile,
    research,
    vertical,
  };

  const userPrompt = buildUserPrompt(input, value, {
    tokenBlock,
    logoUrl,
    faviconHref,
    fontHref,
    booking: null,
  });

  // The full pasteable prompt: the design brief followed by the seeded task.
  const prompt = `${DESIGN_BRIEF}\n\n${userPrompt}`;

  const copied = copyToClipboard(prompt);

  // stdout: the raw prompt only when piped, so `| pbcopy` carries exactly it.
  if (!process.stdout.isTTY) {
    process.stdout.write(prompt);
  }

  log(`smoke:builder — vertical ${vertical.id}`);
  log(`Loaded research from ${source}.`);
  log(`Voices ${research.voices.length}; stage band ${research.extension.context.stage_band ?? "n/a"}.`);
  log(copied ? "Copied the builder prompt to the clipboard." : "pbcopy unavailable; pipe stdout instead.");
  log("Paste it into a Claude Code session to generate the page.");
  log();

  const checks = [
    {
      name: "value render carries the headline expression verbatim",
      pass: prompt.includes(value.headline.value),
    },
    {
      name: "value render carries the mechanism sentence",
      pass: prompt.includes(value.mechanism),
    },
    {
      name: "prompt names the prospect company",
      pass: prompt.includes(sampleLead.company),
    },
    {
      name: "design brief asks founder to founder, not for a demo booking",
      pass: /founder-to-founder|founder to founder/i.test(DESIGN_BRIEF),
    },
    {
      name: "design brief forbids the old metric tiles, charts, and scenario cards",
      pass: /no metric tiles/i.test(DESIGN_BRIEF) && /no\b[^.]*scenario cards/i.test(DESIGN_BRIEF),
    },
    {
      name: "design brief renders the value expression and its mechanism",
      pass: /headline value expression/i.test(DESIGN_BRIEF) && /mechanism/i.test(DESIGN_BRIEF),
    },
  ];

  let allPass = true;
  for (const check of checks) {
    log(`  ${check.pass ? "PASS" : "FAIL"}  ${check.name}`);
    if (!check.pass) allPass = false;
  }
  log();
  log(allPass ? "SMOKE BUILDER: PASS" : "SMOKE BUILDER: FAIL (a prompt check failed)");
  if (!allPass) process.exitCode = 1;
} catch (e) {
  log(`SMOKE BUILDER: FAIL ${(e as Error).constructor.name}: ${(e as Error).message}`);
  process.exitCode = 1;
}
