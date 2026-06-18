// Anthropic model client and the in-process agent loop (D45).
//
// The provided key routes through a gateway that does not expose Managed Agents,
// so the agent loop runs here: the model emits tool_use blocks, this loop runs
// the tools, feeds results back, and repeats until the model stops or calls the
// terminal tool. A forced tool_choice on the terminal tool yields structured
// output without parsing free text. See mirenta-managed-agents-unreachable.

import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config/env.ts";

let client: Anthropic | null = null;

export function anthropic(): Anthropic {
  if (!client) {
    client = new Anthropic({
      apiKey: config.anthropic.apiKey,
      baseURL: config.anthropic.baseUrl,
      maxRetries: 3,
    });
  }
  return client;
}

// A tool the loop can execute locally. `run` receives the model's validated-shape
// input and returns a string result fed back as the tool_result.
export interface LoopTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  run: (input: Record<string, unknown>) => Promise<string>;
}

export interface AgentLoopOptions {
  model: string;
  system: string;
  prompt: string;
  tools: LoopTool[];
  // The terminal tool whose call ends the loop and whose input is the result.
  // Provided separately because the loop forces it once work is done.
  finalTool: {
    name: string;
    description: string;
    input_schema: Record<string, unknown>;
  };
  maxTurns?: number;
  maxTokens?: number;
  // Optional progress hook for surgical instrumentation.
  onStep?: (step: AgentStep) => void;
}

export interface AgentStep {
  turn: number;
  kind: "text" | "tool_use" | "tool_result" | "final" | "stop";
  detail: string;
}

export class AgentRefusalError extends Error {}
export class AgentMaxTurnsError extends Error {}

type Block = Anthropic.Messages.ContentBlockParam;

// Run the loop. Returns the validated input object the model passed to finalTool.
// Throws AgentRefusalError on a model refusal (permanent) and AgentMaxTurnsError
// when the loop runs past its turn ceiling without finishing (transient).
export async function runAgentLoop(opts: AgentLoopOptions): Promise<Record<string, unknown>> {
  const maxTurns = opts.maxTurns ?? 16;
  const maxTokens = opts.maxTokens ?? 8000;
  const toolMap = new Map(opts.tools.map((t) => [t.name, t]));

  const toolDefs: Anthropic.Messages.ToolUnion[] = [
    ...opts.tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.input_schema as Anthropic.Messages.Tool.InputSchema,
    })),
    {
      name: opts.finalTool.name,
      description: opts.finalTool.description,
      input_schema: opts.finalTool.input_schema as Anthropic.Messages.Tool.InputSchema,
    },
  ];

  const messages: Anthropic.Messages.MessageParam[] = [
    { role: "user", content: opts.prompt },
  ];

  for (let turn = 1; turn <= maxTurns; turn++) {
    // On the last allowed turn, force the final tool so the loop always
    // terminates with a structured result rather than trailing off.
    const forceFinal = turn === maxTurns;
    const response = await anthropic().messages.create({
      model: opts.model,
      max_tokens: maxTokens,
      system: opts.system,
      tools: toolDefs,
      tool_choice: forceFinal
        ? { type: "tool", name: opts.finalTool.name }
        : { type: "auto" },
      messages,
    });

    if (response.stop_reason === "refusal") {
      throw new AgentRefusalError("model refused the request");
    }

    const toolUses = response.content.filter(
      (b): b is Anthropic.Messages.ToolUseBlock => b.type === "tool_use",
    );
    const texts = response.content
      .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    if (texts) opts.onStep?.({ turn, kind: "text", detail: texts.slice(0, 200) });

    // Final tool called: return its input as the structured result.
    const finalCall = toolUses.find((t) => t.name === opts.finalTool.name);
    if (finalCall) {
      opts.onStep?.({ turn, kind: "final", detail: opts.finalTool.name });
      return finalCall.input as Record<string, unknown>;
    }

    // No tools at all and not forced: the model is done without a final call.
    if (toolUses.length === 0) {
      opts.onStep?.({ turn, kind: "stop", detail: response.stop_reason ?? "end_turn" });
      // Nudge once toward the terminal tool by looping; on the last turn it is forced.
      messages.push({ role: "assistant", content: response.content });
      messages.push({
        role: "user",
        content: `Call the ${opts.finalTool.name} tool now with your final result.`,
      });
      continue;
    }

    // Execute every requested working tool and feed results back.
    messages.push({ role: "assistant", content: response.content });
    const results: Block[] = [];
    for (const use of toolUses) {
      const tool = toolMap.get(use.name);
      opts.onStep?.({ turn, kind: "tool_use", detail: use.name });
      let resultText: string;
      let isError = false;
      if (!tool) {
        resultText = `Unknown tool: ${use.name}`;
        isError = true;
      } else {
        try {
          resultText = await tool.run(use.input as Record<string, unknown>);
        } catch (err) {
          resultText = `Tool ${use.name} failed: ${(err as Error).message}`;
          isError = true;
        }
      }
      opts.onStep?.({ turn, kind: "tool_result", detail: `${use.name}${isError ? " (error)" : ""}` });
      results.push({
        type: "tool_result",
        tool_use_id: use.id,
        content: resultText,
        is_error: isError,
      });
    }
    messages.push({ role: "user", content: results });
  }

  throw new AgentMaxTurnsError(`agent loop exceeded ${maxTurns} turns`);
}

// One-shot structured generation with no tools: force a single tool and return
// its input. Used by the Website Builder, which needs no search, just synthesis.
export async function generateStructured(opts: {
  model: string;
  system: string;
  prompt: string;
  tool: { name: string; description: string; input_schema: Record<string, unknown> };
  maxTokens?: number;
}): Promise<Record<string, unknown>> {
  const response = await anthropic().messages.create({
    model: opts.model,
    max_tokens: opts.maxTokens ?? 8000,
    system: opts.system,
    tools: [
      {
        name: opts.tool.name,
        description: opts.tool.description,
        input_schema: opts.tool.input_schema as Anthropic.Messages.Tool.InputSchema,
      },
    ],
    tool_choice: { type: "tool", name: opts.tool.name },
    messages: [{ role: "user", content: opts.prompt }],
  });

  if (response.stop_reason === "refusal") {
    throw new AgentRefusalError("model refused the request");
  }
  const call = response.content.find(
    (b): b is Anthropic.Messages.ToolUseBlock =>
      b.type === "tool_use" && b.name === opts.tool.name,
  );
  if (!call) throw new Error("model did not call the forced tool");
  return call.input as Record<string, unknown>;
}
