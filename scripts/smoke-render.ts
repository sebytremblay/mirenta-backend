// Renders a saved builder page artifact to an .html file and opens it for visual
// inspection. This makes NO live API call. It is the third, optional step of the
// smoke chain: after smoke:builder produces the prompt and a human pastes it into
// a Claude Code session, save the returned page here and render it.
//
// Save the page the session returns to /tmp/mirenta-page.json (the {"html": ...}
// object matching PAGE_TOOL_SCHEMA) or to a raw .html file, then run:
//   npm run --silent smoke:render            # reads /tmp/mirenta-page.json
//   npm run --silent smoke:render -- a.html  # reads a raw HTML file
//
// The script runs the SAME production validatePage and injectRuntimeAssets the
// worker runs, reconstructing the validation options from the SAME scenario and
// research smoke:builder used. So the file you inspect is byte-identical to what
// production would ship, and a page that would fail production fails here loud.
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import {
  validatePage,
  injectRuntimeAssets,
  PageValidationError,
  type ValidatePageOptions,
} from "../src/domain/page-validation.ts";
import {
  PAGE_TOOL_SCHEMA,
  collectAssetHosts,
  REQUIRED_ANCHORS,
} from "../src/agents/builder.ts";
import {
  resolveLogoUrl,
  resolveFaviconHref,
} from "../src/agents/brand-tokens.ts";
import { validateResearch } from "../src/domain/research.ts";
import { getVertical } from "../src/verticals/index.ts";
import { selectScenario, smokeProfile } from "./smoke-fixtures.ts";

const RESEARCH_IN = "/tmp/mirenta-research.json";
const DEFAULT_PAGE_IN = "/tmp/mirenta-page.json";
const PAGE_OUT = "/tmp/mirenta-page.html";

const log = (line = ""): void => {
  process.stderr.write(`${line}\n`);
};

// The first non-flag argv entry is an artifact path override; otherwise read the
// JSON artifact smoke:builder's paste flow produces.
function artifactPath(): string {
  const arg = process.argv.slice(2).find((a) => !a.startsWith("-"));
  return arg ?? DEFAULT_PAGE_IN;
}

// Accept either the {"html": "..."} object (the PAGE_TOOL_SCHEMA argument shape,
// the natural save target of the paste flow) or a raw .html file.
function loadHtml(path: string): string {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    throw new Error(
      `no page artifact at ${path}. Run smoke:builder, paste the prompt into a ` +
        `Claude Code session, and save the returned {"html": ...} JSON to ${DEFAULT_PAGE_IN} ` +
        `(or pass a path: npm run --silent smoke:render -- page.html).`,
    );
  }

  const trimmed = text.trimStart();
  if (path.endsWith(".html") || /^<!doctype html/i.test(trimmed)) {
    return text;
  }

  const parsed = JSON.parse(text) as unknown;
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    typeof (parsed as { html?: unknown }).html !== "string"
  ) {
    const key = PAGE_TOOL_SCHEMA.required[0];
    throw new Error(
      `artifact at ${path} is not a {"${key}": "<document>"} object and is not raw HTML.`,
    );
  }
  return (parsed as { html: string }).html;
}

try {
  const html = loadHtml(artifactPath());

  // Reconstruct the validation options from the SAME inputs the builder used, so
  // validation here matches production rather than rubber-stamping the artifact.
  const scenario = selectScenario();
  const lead = scenario.lead;
  const profile = smokeProfile;
  const vertical = getVertical(profile.vertical);

  let researchText: string;
  try {
    researchText = readFileSync(RESEARCH_IN, "utf8");
  } catch {
    throw new Error(
      `no research at ${RESEARCH_IN}. The render step validates the page against ` +
        `the same research the builder built it from; run the smoke chain first.`,
    );
  }
  const research = validateResearch(JSON.parse(researchText) as unknown, vertical);

  const valueModel = vertical.createValueModel(profile);
  const value = valueModel.compute(
    valueModel.validateInputs(
      research.extension.value_inputs,
      research.extension.estimated,
      research.extension.context,
    ),
  );

  const logoUrl = resolveLogoUrl(profile, research.brand);
  const faviconHref = resolveFaviconHref(lead.website_url, research.brand);
  const assetHosts = collectAssetHosts(logoUrl, faviconHref, lead.website_url, null);

  const opts: ValidatePageOptions = {
    value,
    research,
    assetHosts,
    requiredAnchors: REQUIRED_ANCHORS,
    stopReason: "end_turn",
  };

  validatePage(html, opts);

  const finalHtml = injectRuntimeAssets(html);
  writeFileSync(PAGE_OUT, finalHtml, "utf8");

  log(`smoke:render — profile ${scenario.key} (${scenario.label})`);
  log(`Validated against research at ${RESEARCH_IN}; page passes production validation.`);
  log(`Wrote ${finalHtml.length} bytes to ${PAGE_OUT}.`);

  if (process.platform === "darwin") {
    const opened = spawnSync("open", [PAGE_OUT]).status === 0;
    log(opened ? `Opened ${PAGE_OUT} for inspection.` : `open failed; view ${PAGE_OUT} manually.`);
  } else {
    log(`View it at ${PAGE_OUT}.`);
  }
  log();
  log("SMOKE RENDER: PASS");
} catch (e) {
  if (e instanceof PageValidationError) {
    log(`SMOKE RENDER: FAIL the saved page would fail production validation: ${e.message}`);
  } else {
    log(`SMOKE RENDER: FAIL ${(e as Error).constructor.name}: ${(e as Error).message}`);
  }
  process.exitCode = 1;
}
