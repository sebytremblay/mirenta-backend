// Anthropic Messages API client, used by the Website Builder for one-shot
// structured generation (D50). The Research Agent runs on Managed Agents (see
// providers/managed-agents.ts); the builder needs no agent loop, just a single
// forced-tool call, so it talks to the Messages API directly.
//
// The client pins the first-party Anthropic API. The dev shell exports a
// Salesforce gateway URL in ANTHROPIC_BASE_URL plus an ANTHROPIC_AUTH_TOKEN; the
// SDK inherits both from the ambient environment by default, so passing apiKey +
// baseURL explicitly makes the constructor values win. See D50.

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

// Thrown on a model refusal (permanent: a retry repeats it). The builder throws
// this; the research path throws the equivalent from providers/managed-agents.ts.
export class AgentRefusalError extends Error {}

// One-shot structured generation with no tools loop: force a single tool and
// return its input. Used by the Website Builder, which needs no search, just
// synthesis. This is intentionally NOT a Managed Agents session — a one-shot
// generation has no multi-step loop for Anthropic to host, so the direct
// Messages API call is the simpler fit (D50).
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
