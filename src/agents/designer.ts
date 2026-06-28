// The designer (Opus): the third stage. It reads the research and composes a
// bespoke PageSpec the builder renders against. Opus earns its cost here on layout
// judgment, and its output stays small (a section manifest plus an art direction),
// so spend stays bounded; the token-heavy HTML runs on Haiku in the build stage.

import { generateStructured } from "../providers/anthropic.ts";
import type { TokenUsageTotals } from "../providers/usage.ts";
import {
  EMIT_PAGE_SPEC_TOOL,
  PAGE_SPEC_TOOL_SCHEMA,
  DESIGNER_SYSTEM_PROMPT,
  buildDesignerPrompt,
  normalizePageSpec,
  type DesignerInput,
} from "./designer-prompt.ts";
import type { PageSpec } from "../domain/page-spec.ts";

export type { DesignerInput } from "./designer-prompt.ts";
export {
  EMIT_PAGE_SPEC_TOOL,
  PAGE_SPEC_TOOL_SCHEMA,
  DESIGNER_SYSTEM_PROMPT,
  buildDesignerPrompt,
  normalizePageSpec,
  PageSpecSchemaError,
} from "./designer-prompt.ts";

export interface DesignerResult {
  spec: PageSpec;
  usage: TokenUsageTotals;
}

export async function runDesigner(
  input: DesignerInput,
  model: string,
): Promise<DesignerResult> {
  input.onStep?.({ phase: "start", detail: `designing page for ${input.lead.company}` });
  const { input: raw, usage } = await generateStructured({
    model,
    system: DESIGNER_SYSTEM_PROMPT,
    prompt: buildDesignerPrompt(input),
    tool: {
      name: EMIT_PAGE_SPEC_TOOL,
      description: "Emit the bespoke page spec.",
      input_schema: PAGE_SPEC_TOOL_SCHEMA,
    },
  });
  input.onStep?.({ phase: "validate", detail: "validating page spec" });
  const spec = normalizePageSpec(raw);
  input.onStep?.({ phase: "done", detail: `${spec.sections.length} sections` });
  return { spec, usage };
}
