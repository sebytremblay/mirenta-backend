// Link 4 of the four-link smoke chain: the builder. Reads the Strategy (recipe),
// the research, and the PageSpec the prior links produced; evaluates the recipe
// deterministically; resolves the brand tokens exactly as buildSite does; and
// builds the prompt that renders the bespoke one-pager. This makes NO live API
// call. Run code between the links so a bad artifact fails loud in the harness.
//
//   npm run --silent smoke:builder -- --profile=menza
//
// Pass the SAME --profile flag the prior links received. On macOS the prompt
// copies to the clipboard. Paste it into a Claude Code session, run it, and save
// the emitted HTML to /tmp/mirenta-page.html, then validate it with smoke:render.
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
  resolveFontPlan,
} from "../src/agents/brand-tokens.ts";
import { validateStrategy } from "../src/agents/strategist-prompt.ts";
import { validateResearch } from "../src/domain/research.ts";
import { normalizePageSpec } from "../src/agents/designer-prompt.ts";
import { evaluateRecipe } from "../src/domain/recipe.ts";
import { assertValueModelContract } from "../src/domain/value-contract.ts";
import { selectScenario, smokeProfile } from "./smoke-fixtures.ts";
import {
  PAGE_HTML_FILE,
  PAGE_SPEC_FILE,
  RESEARCH_FILE,
  STRATEGY_FILE,
  emitPrompt,
  log,
  outputContract,
  readArtifact,
  runChecks,
} from "./smoke-prompt.ts";

const scenario = selectScenario();
const lead = scenario.lead;
const profile = smokeProfile;

try {
  // Replay the worker's build stage over the chain's artifacts. Each validator is
  // the real one, so a malformed recipe, research, or spec fails here exactly as
  // it fails the worker, not silently in a pasted session.
  const { recipe } = validateStrategy(readArtifact(STRATEGY_FILE, "npm run --silent smoke:strategist"));
  const research = validateResearch(readArtifact(RESEARCH_FILE, "npm run --silent smoke:research"), recipe);
  const spec = normalizePageSpec(readArtifact(PAGE_SPEC_FILE, "npm run --silent smoke:designer"));

  // Deterministic code evaluates the recipe; the LLM never computes the figure.
  const value = evaluateRecipe(recipe, research.extension.recipe_inputs);
  assertValueModelContract(value, research.extension.estimated);

  // Resolve assets the same way buildSite does, seeding the font pairing on the
  // lead company so the smoke reproduces production.
  const fontSeed = lead.company;
  const tokens = deriveTokens(profile, research.brand, undefined, fontSeed);
  const tokenBlock = renderTokenBlock(tokens);
  const logoUrl = resolveLogoUrl(profile, research.brand);
  const faviconHref = resolveFaviconHref(lead.website_url, research.brand);
  const fontHref = resolveFontPlan(research.brand, fontSeed).href;

  const input: BuildSiteInput = { lead, profile, research, recipe, spec };
  const userPrompt = buildUserPrompt(input, value, {
    tokenBlock,
    logoUrl,
    faviconHref,
    fontHref,
    booking: null,
  });

  const contract = outputContract(
    EMIT_PAGE_TOOL,
    PAGE_TOOL_SCHEMA,
    PAGE_HTML_FILE,
    'The "html" field holds the COMPLETE document, from <!DOCTYPE html> through </html>. Render every section the spec lists, in order, under the named art direction. Save ONLY the html string (not the JSON wrapper) to the file.',
  );

  const prompt = `${DESIGN_BRIEF}\n\n${userPrompt}\n\n${contract}`;
  const copied = emitPrompt(prompt);

  log(`smoke:builder — profile ${scenario.key} (${scenario.label})`);
  log(`Lead ${lead.first_name} ${lead.last_name} at ${lead.company}.`);
  log(`Recipe ${recipe.op} (${recipe.unit}) -> "${value.headline.value}". Sections: ${spec.sections.map((s) => s.kind).join(" > ")}.`);
  log(`Art direction: ${spec.artDirection.name}.`);
  log(copied ? "Copied the builder prompt to the clipboard." : "pbcopy unavailable; pipe stdout instead.");
  log(`Paste it into a Claude Code session, then save the HTML to ${PAGE_HTML_FILE} and run smoke:render.`);
  log();

  runChecks("SMOKE BUILDER", [
    {
      name: "value render carries the precomputed headline expression verbatim",
      pass: prompt.includes(value.headline.value),
    },
    {
      name: "value render carries the mechanism sentence",
      pass: prompt.includes(value.mechanism),
    },
    {
      name: "prompt lists every bespoke section id the designer named",
      pass: spec.sections.every((s) => prompt.includes(`id="${s.id}"`)),
    },
    {
      name: "prompt names the value-render and CTA section ids",
      pass: prompt.includes(spec.valueRenderSectionId) && prompt.includes(spec.ctaSectionId),
    },
    {
      name: "prompt carries the designer art direction, not a fixed menu",
      pass: prompt.includes(spec.artDirection.name) && /ART DIRECTION \(named by the designer/.test(prompt),
    },
    {
      name: "design brief carries the anti-AI-copy rules",
      pass: /tricolon/i.test(DESIGN_BRIEF) && /superlative/i.test(DESIGN_BRIEF) && /vary sentence length/i.test(DESIGN_BRIEF),
    },
    {
      name: "prompt carries the emit_page schema with every required key",
      pass: prompt.includes(EMIT_PAGE_TOOL) && PAGE_TOOL_SCHEMA.required.every((k) => prompt.includes(`"${k}"`)),
    },
  ]);
} catch (e) {
  log(`SMOKE BUILDER: FAIL ${(e as Error).constructor.name}: ${(e as Error).message}`);
  process.exitCode = 1;
}
