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

// Thrown when the agent refuses the request. Permanent: a retry repeats it.
export class AgentRefusalError extends Error {}
// Thrown when the session terminates or stalls without emitting a result.
export class AgentSessionError extends Error {}

export interface ManagedSessionStep {
  kind: "text" | "search" | "final" | "error" | "status";
  detail: string;
}

export interface RunManagedSessionOptions {
  // The kickoff message that starts the agent working (phase guidance lives in
  // the persistent agent's system prompt).
  kickoff: string;
  // The custom tool whose input carries the structured result and ends the run.
  finalToolName: string;
  // Hard wall-clock ceiling. The SSE iterator blocks when no events arrive, so a
  // stuck session must be abortable. Defaults to the worker lease minus a margin.
  timeoutMs?: number;
  onStep?: (step: ManagedSessionStep) => void;
}

// Run one research session end to end and return the structured object the agent
// passed to its final tool. Creates and deletes a session against the persistent
// agent/environment/vault; throws if the agent refuses or the session ends
// without emitting a result.
export async function runManagedSession(
  opts: RunManagedSessionOptions,
): Promise<Record<string, unknown>> {
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

  // Hard guard: abort the stream if the session stalls. The async iterator would
  // otherwise block forever when the session goes idle waiting on nothing.
  const ac = new AbortController();
  const timeoutMs = opts.timeoutMs ?? 600_000;
  const guard = setTimeout(() => ac.abort(), timeoutMs);

  try {
    // Stream-first, then kick off, so no early events are missed (Pattern 7).
    const stream = await c.beta.sessions.events.stream(session.id, undefined, {
      signal: ac.signal,
    });
    await c.beta.sessions.events.send(session.id, {
      events: [{ type: "user.message", content: [{ type: "text", text: opts.kickoff }] }],
    });

    let result: Record<string, unknown> | null = null;

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
          if (nameOf(event) === opts.finalToolName) {
            // Harvest the structured object. Acknowledge so the session can
            // finish cleanly rather than parking on us.
            result = (event as { input?: Record<string, unknown> }).input ?? {};
            opts.onStep?.({ kind: "final", detail: opts.finalToolName });
            await c.beta.sessions.events.send(session.id, {
              events: [
                {
                  type: "user.custom_tool_result",
                  custom_tool_use_id: (event as { id: string }).id,
                  content: [{ type: "text", text: "Recorded." }],
                },
              ],
            });
          }
          break;
        }
        case "session.error":
          opts.onStep?.({ kind: "error", detail: JSON.stringify(event).slice(0, 200) });
          break;
        case "session.status_idle": {
          const stop = (event as { stop_reason?: { type?: string } }).stop_reason?.type;
          opts.onStep?.({ kind: "status", detail: `idle:${stop ?? "?"}` });
          if (stop === "refusal") {
            throw new AgentRefusalError("agent refused the research request");
          }
          // requires_action means the session waits on us. If we already have the
          // result we acknowledged it above and can stop; otherwise keep draining
          // (a confirmation we do not expect would surface as a stall the guard
          // catches). Any other terminal idle ends the run.
          if (stop === "requires_action") {
            if (result) return result;
            break;
          }
          // end_turn or retries_exhausted: terminal.
          if (result) return result;
          throw new AgentSessionError(`session idle (${stop}) without emitting ${opts.finalToolName}`);
        }
        case "session.status_terminated":
          opts.onStep?.({ kind: "status", detail: "terminated" });
          if (result) return result;
          throw new AgentSessionError("session terminated without emitting a result");
      }
    }

    if (result) return result;
    throw new AgentSessionError("event stream ended without a result");
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      throw new AgentSessionError(`research session exceeded ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(guard);
    // Best-effort cleanup. A leaked session is harmless but untidy; never let a
    // cleanup error mask the real outcome.
    try {
      await c.beta.sessions.delete(session.id);
    } catch {
      // ignore
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
