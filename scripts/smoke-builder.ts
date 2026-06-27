// Delivers the builder prompt so a human can paste it into a Claude Code session
// and generate the page by hand. This makes NO live API call. It is phase two of
// the two-phase smoke chain: it reads the research object phase one (smoke:research)
// produced at /tmp/mirenta-research.json and renders the page for that SAME
// prospect. The two phases share their seed through smoke-fixtures.ts, so they
// never describe different prospects.
//
// Phase two REQUIRES phase one's output. When the file is absent it fails loud
// with the command to run first, rather than substituting baked-in data — a
// silent fallback would let phase two pass without phase one ever running.
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
import { EMIT_PAGE_TOOL, PAGE_TOOL_SCHEMA } from "../src/agents/builder.ts";
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
import { smokeLead, smokeProfile } from "./smoke-fixtures.ts";
import { readFileSync } from "node:fs";

// Phase one (smoke:research) writes here; phase two reads it. The path lives in
// both scripts; smoke-fixtures.ts holds the shared seed they run against.
const RESEARCH_IN = "/tmp/mirenta-research.json";

// Both phases target the same prospect and customer profile.
const sampleLead = smokeLead;
const sampleProfile = smokeProfile;

// Read the research exactly as the worker's build stage does: resolve the
// vertical from the profile through getVertical (tick.ts), then validate the
// payload through validateResearch. Phase one's file is REQUIRED — its absence
// throws so the smoke fails loud rather than rendering baked-in data, and a
// present-but-invalid file fails the same way a malformed research row fails the
// worker permanently. The smoke never papers over output production would reject.
function loadResearch(): { research: ResearchObject; vertical: VerticalSpec; source: string } {
  let text: string;
  try {
    text = readFileSync(RESEARCH_IN, "utf8");
  } catch {
    throw new Error(
      `no research at ${RESEARCH_IN}. Run phase one first: ` +
        `npm run --silent smoke:research, paste the prompt into a Claude Code ` +
        `session, and save the emitted research object to ${RESEARCH_IN}.`,
    );
  }

  const raw = JSON.parse(text) as unknown;
  const vertical = getVertical(sampleProfile.vertical);
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

  // In production the builder calls the emit_page tool, whose argument shape is
  // PAGE_TOOL_SCHEMA. A pasted Claude Code session has no such tool, so spell the
  // structured output out: return the page as JSON matching the exact schema the
  // tool enforces. The schema is the one source of truth, printed verbatim, so
  // the smoke never drifts from the builder.
  const outputContract = `# Structured output

This session has no ${EMIT_PAGE_TOOL} tool. Instead of calling it, produce its argument as JSON.

Write a single JSON object that conforms EXACTLY to this JSON Schema (the same schema the ${EMIT_PAGE_TOOL} tool enforces in production). The "html" field holds the COMPLETE document, from <!DOCTYPE html> through </html>. Emit the JSON inside one \`\`\`json block and nothing else:

\`\`\`json
${JSON.stringify(PAGE_TOOL_SCHEMA, null, 2)}
\`\`\``;

  // The full pasteable prompt: the design brief, the seeded task, the output shape.
  const prompt = `${DESIGN_BRIEF}\n\n${userPrompt}\n\n${outputContract}`;

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
    {
      name: "prompt carries the emit_page structured-output schema with every required key",
      pass:
        prompt.includes(EMIT_PAGE_TOOL) &&
        PAGE_TOOL_SCHEMA.required.every((k) => prompt.includes(`"${k}"`)),
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
