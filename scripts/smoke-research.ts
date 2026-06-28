// Link 2 of the four-link smoke chain: the research agent. Reads the Strategy
// link 1 produced, validates it through the real validateStrategy, and builds the
// research kickoff off the strategist's plan and recipe. This makes NO live API
// call. In production the managed agent runs this same prompt with the Exa tools.
//
//   npm run --silent smoke:research -- --profile=menza
//
// Pass the SAME --profile flag link 1 received so both links describe the same
// lead. On macOS the prompt copies to the clipboard. Paste it into a Claude Code
// session with the Exa search tools, run the five phases, and save the emitted
// research object to /tmp/mirenta-research.json.
import { buildAgentSystemPrompt, buildKickoff, EMIT_RESEARCH_TOOL } from "../src/agents/research.ts";
import { RESEARCH_TOOL_SCHEMA } from "../src/domain/research.ts";
import { validateStrategy } from "../src/agents/strategist-prompt.ts";
import { selectScenario, smokeProfile } from "./smoke-fixtures.ts";
import {
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
  // Read link 1's Strategy exactly as the worker's research stage does: parse the
  // persisted artifact, then validate it through validateStrategy. A missing or
  // malformed strategy fails the same way it fails the worker permanently.
  const strategy = validateStrategy(readArtifact(STRATEGY_FILE, "npm run --silent smoke:strategist"));
  const { plan, recipe } = strategy;

  const systemPrompt = buildAgentSystemPrompt();
  const kickoff = buildKickoff({ lead: scenario.lead, profile: smokeProfile, plan, recipe });

  const contract = outputContract(
    EMIT_RESEARCH_TOOL,
    RESEARCH_TOOL_SCHEMA,
    RESEARCH_FILE,
    `Source every recipe input key the kickoff names and place it under extension.recipe_inputs.values: ${recipe.inputs
      .map((i) => i.key)
      .join(", ") || "(none; this recipe needs no numeric input)"}.`,
  );

  const prompt = `${systemPrompt}\n\n${kickoff}\n\n${contract}`;
  const copied = emitPrompt(prompt);

  log(`smoke:research — profile ${scenario.key} (${scenario.label})`);
  log(`Lead ${scenario.lead.first_name} ${scenario.lead.last_name} at ${scenario.lead.company}.`);
  log(`Plan domains: ${plan.domains.join(", ")}. Recipe op: ${recipe.op} (${recipe.unit}).`);
  log(copied ? "Copied the research prompt to the clipboard." : "pbcopy unavailable; pipe stdout instead.");
  log(`Paste it into a Claude Code session with the Exa tools, then save the research to ${RESEARCH_FILE}.`);
  log();

  runChecks("SMOKE RESEARCH", [
    {
      name: "prompt hunts respected voices on the self/backer/tribe ladder",
      pass: /self/.test(prompt) && /backer/.test(prompt) && /tribe/.test(prompt),
    },
    {
      name: "prompt carries the strategist plan domains",
      pass: plan.domains.every((d) => prompt.includes(d)),
    },
    {
      name: "prompt names every recipe input key the research must source",
      pass: recipe.inputs.every((i) => prompt.includes(i.key)),
    },
    {
      name: "prompt carries the research schema with every required key",
      pass: RESEARCH_TOOL_SCHEMA.required.every((k) => prompt.includes(`"${k}"`)),
    },
  ]);
} catch (e) {
  log(`SMOKE RESEARCH: FAIL ${(e as Error).constructor.name}: ${(e as Error).message}`);
  process.exitCode = 1;
}
