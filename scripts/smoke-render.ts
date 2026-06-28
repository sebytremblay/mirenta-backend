// The validation step of the four-link smoke chain. Reads the saved builder page,
// reconstructs the production validatePage options from the SAME chain artifacts
// the builder used (the recipe, the research, the page spec), runs the production
// validatePage and injectRuntimeAssets, and opens the page for inspection. This
// makes NO live API call. A page that would fail production fails here loud.
//
// After smoke:builder, save the HTML the session returns to /tmp/mirenta-page.html
// (raw) or a {"html": ...} JSON file, then run:
//   npm run --silent smoke:render            # reads /tmp/mirenta-page.html
//   npm run --silent smoke:render -- a.html  # reads a path you pass
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import {
  validatePage,
  injectRuntimeAssets,
  PageValidationError,
  type ValidatePageOptions,
} from "../src/domain/page-validation.ts";
import { PAGE_TOOL_SCHEMA, collectAssetHosts } from "../src/agents/builder.ts";
import { resolveLogoUrl, resolveFaviconHref } from "../src/agents/brand-tokens.ts";
import { validateStrategy } from "../src/agents/strategist-prompt.ts";
import { validateResearch } from "../src/domain/research.ts";
import { normalizePageSpec } from "../src/agents/designer-prompt.ts";
import { evaluateRecipe } from "../src/domain/recipe.ts";
import { selectScenario, smokeProfile } from "./smoke-fixtures.ts";
import { PAGE_HTML_FILE, PAGE_SPEC_FILE, RESEARCH_FILE, STRATEGY_FILE, log, readArtifact } from "./smoke-prompt.ts";

const PAGE_OUT = "/tmp/mirenta-page.html";

// The first non-flag argv entry overrides the artifact path; otherwise read the
// HTML the builder paste flow saves.
function artifactPath(): string {
  const arg = process.argv.slice(2).find((a) => !a.startsWith("-"));
  return arg ?? PAGE_HTML_FILE;
}

// Accept either raw HTML or the {"html": "..."} object (the PAGE_TOOL_SCHEMA
// argument shape) so the step reads whichever the paste flow saved.
function loadHtml(path: string): string {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    throw new Error(
      `no page artifact at ${path}. Run smoke:builder, paste the prompt into a ` +
        `Claude Code session, and save the returned HTML to ${PAGE_HTML_FILE} ` +
        `(or pass a path: npm run --silent smoke:render -- page.html).`,
    );
  }
  const trimmed = text.trimStart();
  if (path.endsWith(".html") || /^<!doctype html/i.test(trimmed)) return text;

  const parsed = JSON.parse(text) as unknown;
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    typeof (parsed as { html?: unknown }).html !== "string"
  ) {
    const key = PAGE_TOOL_SCHEMA.required[0];
    throw new Error(`artifact at ${path} is not a {"${key}": "<document>"} object and is not raw HTML.`);
  }
  return (parsed as { html: string }).html;
}

try {
  const html = loadHtml(artifactPath());

  // Reconstruct the validation options from the SAME chain artifacts the builder
  // used, so validation here matches production rather than rubber-stamping.
  const scenario = selectScenario();
  const lead = scenario.lead;
  const profile = smokeProfile;

  const { recipe } = validateStrategy(readArtifact(STRATEGY_FILE, "npm run --silent smoke:strategist"));
  const research = validateResearch(readArtifact(RESEARCH_FILE, "npm run --silent smoke:research"), recipe);
  const spec = normalizePageSpec(readArtifact(PAGE_SPEC_FILE, "npm run --silent smoke:designer"));
  const value = evaluateRecipe(recipe, research.extension.recipe_inputs);

  const logoUrl = resolveLogoUrl(profile, research.brand);
  const faviconHref = resolveFaviconHref(lead.website_url, research.brand);
  const assetHosts = collectAssetHosts(logoUrl, faviconHref, lead.website_url, null);

  const opts: ValidatePageOptions = { value, research, assetHosts, spec, stopReason: "end_turn" };
  validatePage(html, opts);

  const finalHtml = injectRuntimeAssets(html);
  writeFileSync(PAGE_OUT, finalHtml, "utf8");

  log(`smoke:render — profile ${scenario.key} (${scenario.label})`);
  log(`Validated against the chain artifacts; page passes production validation.`);
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
