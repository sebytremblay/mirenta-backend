// The strategist (Opus): the first stage. Given the lead and the seller product,
// it plans what to investigate and how to quantify the value, then emits a
// compact Strategy the rest of the pipeline runs against. It does no research and
// writes no prose for the page; it decides the shape of the work. Opus earns its
// cost here on judgment, and its output stays small, so spend stays bounded.

import { generateStructured } from "../providers/anthropic.ts";
import type { TokenUsageTotals } from "../providers/usage.ts";
import {
  EMIT_STRATEGY_TOOL,
  STRATEGY_TOOL_SCHEMA,
  STRATEGIST_SYSTEM_PROMPT,
  buildStrategistPrompt,
  validateStrategy,
  type Strategy,
  type StrategistInput,
} from "./strategist-prompt.ts";

export type { Strategy, StrategistInput, ResearchPlan } from "./strategist-prompt.ts";
export {
  EMIT_STRATEGY_TOOL,
  STRATEGY_TOOL_SCHEMA,
  STRATEGIST_SYSTEM_PROMPT,
  buildStrategistPrompt,
  validateStrategy,
  StrategySchemaError,
} from "./strategist-prompt.ts";

export interface StrategistResult {
  strategy: Strategy;
  usage: TokenUsageTotals;
}

export async function runStrategist(
  input: StrategistInput,
  model: string,
): Promise<StrategistResult> {
  input.onStep?.({ phase: "start", detail: `planning strategy for ${input.lead.company}` });
  const { input: raw, usage } = await generateStructured({
    model,
    system: STRATEGIST_SYSTEM_PROMPT,
    prompt: buildStrategistPrompt(input),
    tool: {
      name: EMIT_STRATEGY_TOOL,
      description: "Emit the research plan and the metric recipe.",
      input_schema: STRATEGY_TOOL_SCHEMA,
    },
  });
  input.onStep?.({ phase: "validate", detail: "validating strategy" });
  const strategy = validateStrategy(raw);
  input.onStep?.({ phase: "done", detail: `recipe op ${strategy.recipe.op}` });
  return { strategy, usage };
}
