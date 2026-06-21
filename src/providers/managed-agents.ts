// Claude Managed Agents client: drives a server-side research session (D50).
//
// Anthropic holds the agent loop. We create a session against the persistent
// research agent and cloud environment, the agent searches the web through
// Exa's hosted MCP server (authenticated by a vaulted static-bearer credential),
// and it finishes by calling a custom `emit_research` tool. We harvest that
// tool's input as the structured research object — the Managed Agents equivalent
// of the forced tool_choice the in-process loop used before.
//
// The session is driven synchronously inside one worker tick: open the stream,
// kick off, drain to a terminal idle, return. No agent loop runs on Mirenta's
// compute. See [[mirenta-managed-agents-reachable]].

import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config/env.ts";
import { AgentRefusalError } from "./anthropic.ts";
import { addUsage, emptyUsage, usageFromRaw, type TokenUsageTotals } from "./usage.ts";

// Re-export so the research path and the builder path share one refusal type.
// Both mean the same thing to the worker: a refusal is a permanent failure.
export { AgentRefusalError };

let client: Anthropic | null = null;

// The Managed Agents client. Pinned to the first-party Anthropic API so the
// ambient ANTHROPIC_BASE_URL/ANTHROPIC_AUTH_TOKEN the dev shell exports (a
// Salesforce gateway that 401s the Managed Agents endpoints) cannot leak in.
// Passing apiKey + baseURL explicitly makes the constructor values win over the
// inherited environment. See D50.
export function managedAgentsClient(): Anthropic {
  if (!client) {
    client = new Anthropic({
      apiKey: config.anthropic.apiKey,
      baseURL: config.anthropic.baseUrl,
      maxRetries: 3,
    });
  }
  return client;
}

// Thrown when the session terminates or stalls without emitting a result.
// Transient: the worker retries via the lease.
export class AgentSessionError extends Error {}

export interface ManagedSessionStep {
  kind: "text" | "search" | "final" | "error" | "status";
  detail: string;
}

// How the drain loop reacts to a session.status_idle event. Pure so the
// branch logic (the load-bearing transient/permanent split) is unit-testable
// without a live session.
//   "return"   -> the result is in hand; finish the run
//   "refusal"  -> the agent refused; permanent failure
//   "wait"     -> the session parks on us with no result yet; keep draining
//   "error"    -> terminal idle with no result; transient session failure
export type IdleAction = "return" | "refusal" | "wait" | "error";

export function classifyIdle(stop: string | undefined, hasResult: boolean): IdleAction {
  if (stop === "refusal") return "refusal";
  if (hasResult) return "return";
  // No result yet. requires_action means the session waits on a client event,
  // so keep draining; any other terminal idle (end_turn, retries_exhausted)
  // ended the turn without emitting the final tool, which is a session failure.
  return stop === "requires_action" ? "wait" : "error";
}

export interface RunManagedSessionOptions {
  // The kickoff message that starts the agent working (phase guidance lives in
  // the persistent agent's system prompt).
  kickoff: string;
  // The custom tool whose input carries the structured result and ends the run.
  finalToolName: string;
  // Hard wall-clock ceiling. The SSE iterator blocks when no events arrive, so a
  // stuck session needs an abort. Defaults to the worker lease minus a margin.
  timeoutMs?: number;
  onStep?: (step: ManagedSessionStep) => void;
}

// The structured result plus the token usage the session accumulated across its
// model requests. The worker persists the usage per agent stage (D33 precursor
// infra); the research result feeds the validator.
export interface ManagedSessionResult {
  result: Record<string, unknown>;
  usage: TokenUsageTotals;
}

// Run one research session end to end and return the structured object the agent
// passed to its final tool, plus the accumulated token usage. Creates and deletes
// a session against the persistent agent/environment/vault; throws if the agent
// refuses or the session ends without emitting a result.
export async function runManagedSession(
  opts: RunManagedSessionOptions,
): Promise<ManagedSessionResult> {
  const c = managedAgentsClient();
  const { environmentId, researchAgentId, exaVaultId } = config.managedAgents;
  if (!environmentId || !researchAgentId) {
    throw new AgentSessionError(
      "Managed Agents not provisioned: set ANTHROPIC_ENVIRONMENT_ID and ANTHROPIC_RESEARCH_AGENT_ID (run scripts/provision-managed-agents.ts)",
    );
  }

  const session = await c.beta.sessions.create({
    agent: researchAgentId,
    environment_id: environmentId,
    vault_ids: exaVaultId ? [exaVaultId] : undefined,
    title: "mirenta research",
  });

  // Hard guard: abort the stream if the session stalls. The async iterator
  // blocks when no events arrive, so a stuck session needs a wall-clock ceiling.
  // The SDK swallows the abort and ends the iterator cleanly (it does not throw),
  // so track the timeout with a flag and report it after the loop ends.
  const ac = new AbortController();
  const timeoutMs = opts.timeoutMs ?? 600_000;
  let timedOut = false;
  const guard = setTimeout(() => {
    timedOut = true;
    ac.abort();
  }, timeoutMs);

  let cleanExit = false;
  let result: Record<string, unknown> | null = null;
  // Accumulate token usage across every model request the session makes. Each
  // span.model_request_end carries one model_usage record (D33 precursor infra).
  let usage = emptyUsage();
  try {
    // Stream-first, then kick off, so no early events are missed (Pattern 7).
    const stream = await c.beta.sessions.events.stream(session.id, undefined, {
      signal: ac.signal,
    });
    await c.beta.sessions.events.send(session.id, {
      events: [{ type: "user.message", content: [{ type: "text", text: opts.kickoff }] }],
    });

    for await (const event of stream) {
      switch (event.type) {
        case "agent.message": {
          const text = extractText(event);
          if (text) opts.onStep?.({ kind: "text", detail: text.slice(0, 160) });
          break;
        }
        case "agent.mcp_tool_use":
          opts.onStep?.({ kind: "search", detail: nameOf(event) });
          break;
        case "agent.custom_tool_use": {
          // Harvest the final tool's input as the result. Acknowledge every
          // custom tool so the session never parks waiting on us: an unexpected
          // tool gets a result and the loop keeps draining rather than stalling
          // to the timeout. Only the final tool sets the return value.
          if (nameOf(event) === opts.finalToolName) {
            result = (event as { input?: Record<string, unknown> }).input ?? {};
            opts.onStep?.({ kind: "final", detail: opts.finalToolName });
          }
          await c.beta.sessions.events.send(session.id, {
            events: [
              {
                type: "user.custom_tool_result",
                custom_tool_use_id: (event as { id: string }).id,
                content: [{ type: "text", text: "Recorded." }],
              },
            ],
          });
          break;
        }
        case "span.model_request_end": {
          // One model request finished; fold its usage into the running total.
          const modelUsage = (event as { model_usage?: unknown }).model_usage;
          usage = addUsage(usage, usageFromRaw(modelUsage, 1));
          break;
        }
        case "span.outcome_evaluation_end": {
          // The rubric-less research agent runs no outcome evaluation, so this
          // case stays dead in practice. Fold its usage in anyway so the totals
          // stay honest if a rubric ever attaches; the evaluation is one model
          // request of its own.
          const evalUsage = (event as { usage?: unknown }).usage;
          usage = addUsage(usage, usageFromRaw(evalUsage, 1));
          break;
        }
        case "session.error":
          opts.onStep?.({ kind: "error", detail: JSON.stringify(event).slice(0, 200) });
          break;
        case "session.status_idle": {
          const stop = (event as { stop_reason?: { type?: string } }).stop_reason?.type;
          opts.onStep?.({ kind: "status", detail: `idle:${stop ?? "?"}` });
          const action = classifyIdle(stop, result !== null);
          if (action === "refusal") {
            throw new AgentRefusalError("agent refused the research request");
          }
          if (action === "return") {
            cleanExit = true;
            return { result: result as Record<string, unknown>, usage };
          }
          if (action === "wait") break; // session waits on a client event; keep draining
          // "error": terminal idle (end_turn, retries_exhausted) with no result.
          throw new AgentSessionError(`session idle (${stop}) without emitting ${opts.finalToolName}`);
        }
        case "session.status_terminated":
          opts.onStep?.({ kind: "status", detail: "terminated" });
          if (result) {
            cleanExit = true;
            return { result, usage };
          }
          throw new AgentSessionError("session terminated without emitting a result");
      }
    }

    // The iterator ended without a terminal idle. A fired guard means the
    // wall-clock ceiling aborted it; otherwise the stream closed on its own.
    if (timedOut) throw new AgentSessionError(`research session exceeded ${timeoutMs}ms`);
    if (result) {
      cleanExit = true;
      return { result, usage };
    }
    throw new AgentSessionError("event stream ended without a result");
  } finally {
    clearTimeout(guard);
    // Best-effort cleanup. A still-running session rejects delete (400), so
    // interrupt it first on any non-clean exit (timeout, stall, error). Never
    // let a cleanup failure mask the real outcome, but surface it so a leaked
    // session is observable rather than silent.
    try {
      if (!cleanExit) {
        await c.beta.sessions.events
          .send(session.id, { events: [{ type: "user.interrupt" }] })
          .catch(() => {});
      }
      await c.beta.sessions.delete(session.id);
    } catch (err) {
      opts.onStep?.({ kind: "error", detail: `session cleanup failed: ${(err as Error).message}` });
    }
  }
}

// Extract concatenated text from an agent.message event's content blocks.
function extractText(event: unknown): string {
  const content = (event as { content?: Array<{ type?: string; text?: string }> }).content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((b) => b?.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .join("");
}

function nameOf(event: unknown): string {
  return (event as { name?: string }).name ?? "";
}
