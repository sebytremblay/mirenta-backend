// Link 3 of the four-link smoke chain: the designer. Reads the Strategy (for the
// recipe) and the research link 2 produced, validates the research against the
// recipe through the real validateResearch, and builds the prompt that composes a
// bespoke PageSpec for this lead. This makes NO live API call.
//
//   npm run --silent smoke:designer -- --profile=menza
//
// Pass the SAME --profile flag the prior links received. On macOS the prompt
// copies to the clipboard. Paste it into a Claude Code session, run it, and save
// the emitted PageSpec to /tmp/mirenta-page-spec.json.
import {
  DESIGNER_SYSTEM_PROMPT,
  buildDesignerPrompt,
  EMIT_PAGE_SPEC_TOOL,
  PAGE_SPEC_TOOL_SCHEMA,
} from "../src/agents/designer-prompt.ts";
import { validateStrategy } from "../src/agents/strategist-prompt.ts";
import { validateResearch } from "../src/domain/research.ts";
import { selectScenario, smokeProfile } from "./smoke-fixtures.ts";
import {
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

try {
  const { recipe } = validateStrategy(
    readArtifact(STRATEGY_FILE, "npm run --silent smoke:strategist"),
  );
  // Validate the research against the recipe exactly as the worker's designer
  // stage does, so a research object missing a recipe input fails here too.
  const research = validateResearch(
    readArtifact(RESEARCH_FILE, "npm run --silent smoke:research"),
    recipe,
  );

  const prompt = `${DESIGNER_SYSTEM_PROMPT}\n\n${buildDesignerPrompt({
    lead: scenario.lead,
    profile: smokeProfile,
    research,
    recipe,
  })}\n\n${outputContract(EMIT_PAGE_SPEC_TOOL, PAGE_SPEC_TOOL_SCHEMA, PAGE_SPEC_FILE, "Let this founder's research drive the structure: two founders with different research must get visibly different section orders and counts, not one default skeleton.")}`;

  const copied = emitPrompt(prompt);

  log(`smoke:designer — profile ${scenario.key} (${scenario.label})`);
  log(`Lead ${scenario.lead.first_name} ${scenario.lead.last_name} at ${scenario.lead.company}.`);
  log(`Priorities ${research.extension.priorities.length}; voices ${research.voices.length}.`);
  log(copied ? "Copied the designer prompt to the clipboard." : "pbcopy unavailable; pipe stdout instead.");
  log(`Paste it into a Claude Code session, then save the PageSpec to ${PAGE_SPEC_FILE}.`);
  log();

  runChecks("SMOKE DESIGNER", [
    {
      name: "prompt grounds the spec in this founder's priorities",
      pass: research.extension.priorities.every((p) => prompt.includes(p.domain)),
    },
    {
      name: "prompt names the value-render heading from the recipe",
      pass: prompt.includes(recipe.sectionTitle) && prompt.includes(recipe.headlineLabel),
    },
    {
      name: "prompt demands a bespoke per-founder structure, not a fixed skeleton",
      pass: /visibly different/i.test(prompt) && /skeleton/i.test(prompt),
    },
    {
      name: "prompt carries the page-spec schema with every required key",
      pass: PAGE_SPEC_TOOL_SCHEMA.required.every((k) => prompt.includes(`"${k}"`)),
    },
  ]);
} catch (e) {
  log(`SMOKE DESIGNER: FAIL ${(e as Error).constructor.name}: ${(e as Error).message}`);
  process.exitCode = 1;
}
