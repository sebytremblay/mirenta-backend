// Link 1 of the four-link smoke chain: the strategist. Builds the pasteable
// prompt that plans the research plan plus the metric recipe for one lead, and
// names where to save the emitted Strategy. This makes NO live API call.
//
//   npm run --silent smoke:strategist            # default lead
//   npm run --silent smoke:strategist -- --profile=menza
//
// On macOS the prompt copies to the clipboard. Paste it into a Claude Code
// session, run it, and save the emitted Strategy JSON to /tmp/mirenta-strategy.json.
import {
  STRATEGIST_SYSTEM_PROMPT,
  buildStrategistPrompt,
  EMIT_STRATEGY_TOOL,
  STRATEGY_TOOL_SCHEMA,
  type StrategistInput,
} from "../src/agents/strategist-prompt.ts";
import { selectScenario, smokeProfile } from "./smoke-fixtures.ts";
import { STRATEGY_FILE, emitPrompt, log, outputContract, runChecks } from "./smoke-prompt.ts";

const scenario = selectScenario();
const input: StrategistInput = { lead: scenario.lead, profile: smokeProfile };

const contract = outputContract(
  EMIT_STRATEGY_TOOL,
  STRATEGY_TOOL_SCHEMA,
  STRATEGY_FILE,
  "Plan ONE honest recipe: pick the op that fits the value, set every clamp and the result ceiling to figures a skeptical founder accepts, and choose op identity with unit qualitative when no honest number exists. Never write the displayed number; code computes it.",
);

const prompt = `${STRATEGIST_SYSTEM_PROMPT}\n\n${buildStrategistPrompt(input)}\n\n${contract}`;

const copied = emitPrompt(prompt);

log(`smoke:strategist — profile ${scenario.key} (${scenario.label})`);
log(`Lead ${scenario.lead.first_name} ${scenario.lead.last_name} at ${scenario.lead.company}.`);
log(copied ? "Copied the strategist prompt to the clipboard." : "pbcopy unavailable; pipe stdout instead.");
log(`Paste it into a Claude Code session, then save the emitted Strategy to ${STRATEGY_FILE}.`);
log();

runChecks("SMOKE STRATEGIST", [
  {
    name: "prompt names the lead and the seller product",
    pass: prompt.includes(scenario.lead.company) && prompt.includes(smokeProfile.product_name),
  },
  {
    name: "prompt teaches the closed recipe op set",
    pass: ["identity", "sum", "multiply", "ratio", "range_from_band"].every((op) => prompt.includes(op)),
  },
  {
    name: "prompt guards the overstated-ROI failure on multiply",
    pass: /maxFactor/.test(prompt) && /overstated-ROI|unbounded product/i.test(prompt),
  },
  {
    name: "prompt prefers a qualitative point of view over a fabricated figure",
    pass: /qualitative/i.test(prompt) && /literalValue/.test(prompt),
  },
  {
    name: "prompt carries the strategy schema with every required key",
    pass: STRATEGY_TOOL_SCHEMA.required.every((k) => prompt.includes(`"${k}"`)),
  },
]);
