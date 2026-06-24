import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config/env.ts";
import { usageFromRaw, type TokenUsageTotals } from "./usage.ts";

let client: Anthropic | null = null;

// Pass apiKey + baseURL explicitly so the constructor values win over the
// ambient ANTHROPIC_BASE_URL/ANTHROPIC_AUTH_TOKEN the dev shell exports (a
// Salesforce gateway).
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

export class AgentRefusalError extends Error {}

export interface StructuredResult {
  input: Record<string, unknown>;
  stopReason: string | null;
  usage: TokenUsageTotals;
}

export async function generateStructured(opts: {
  model: string;
  system: string;
  prompt: string;
  tool: { name: string; description: string; input_schema: Record<string, unknown> };
  maxTokens?: number;
}): Promise<StructuredResult> {
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

  const usage = usageFromRaw(response.usage, 1);

  if (response.stop_reason === "refusal") {
    throw new AgentRefusalError("model refused the request");
  }
  const call = response.content.find(
    (b): b is Anthropic.Messages.ToolUseBlock =>
      b.type === "tool_use" && b.name === opts.tool.name,
  );
  // A forced tool truncated mid-arguments (stop_reason max_tokens) can leave no
  // complete tool_use block. Surface truncation rather than a "did not call the
  // tool" error.
  if (!call) {
    if (response.stop_reason === "max_tokens") {
      return { input: {}, stopReason: "max_tokens", usage };
    }
    throw new Error("model did not call the forced tool");
  }
  return { input: call.input as Record<string, unknown>, stopReason: response.stop_reason, usage };
}
