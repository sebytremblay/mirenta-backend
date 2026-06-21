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
import { usageFromRaw, type TokenUsageTotals } from "./usage.ts";

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

// The result of a one-shot structured generation: the forced tool's input plus
// the response stop_reason. The builder reads stopReason to tell a truncated
// document (`max_tokens`) from a clean-but-noncompliant one: truncation is a
// transient fault retried via the lease, while a noncompliant page retries in
// the builder and then fails permanently.
export interface StructuredResult {
  input: Record<string, unknown>;
  stopReason: string | null;
  // Token usage for this one-shot call, mapped from response.usage. The builder
  // accumulates it across corrective retries and the worker persists the total
  // (D33 precursor infra). Present even on a max_tokens truncation, since the
  // partial response still bills.
  usage: TokenUsageTotals;
}

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

  // One Messages call bills as one model request, truncated or not.
  const usage = usageFromRaw(response.usage, 1);

  if (response.stop_reason === "refusal") {
    throw new AgentRefusalError("model refused the request");
  }
  const call = response.content.find(
    (b): b is Anthropic.Messages.ToolUseBlock =>
      b.type === "tool_use" && b.name === opts.tool.name,
  );
  // A forced tool that gets truncated mid-arguments (stop_reason max_tokens) can
  // leave no complete tool_use block. Surface that as a truncation signal the
  // builder retries on the lease, not as a hard "did not call the tool" error.
  if (!call) {
    if (response.stop_reason === "max_tokens") {
      return { input: {}, stopReason: "max_tokens", usage };
    }
    throw new Error("model did not call the forced tool");
  }
  return { input: call.input as Record<string, unknown>, stopReason: response.stop_reason, usage };
}
