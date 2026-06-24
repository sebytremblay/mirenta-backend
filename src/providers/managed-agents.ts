import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config/env.ts";
import { AgentRefusalError } from "./anthropic.ts";
import { addUsage, emptyUsage, usageFromRaw, type TokenUsageTotals } from "./usage.ts";

export { AgentRefusalError };

let client: Anthropic | null = null;

// Pass apiKey + baseURL explicitly so the constructor values win over the
// ambient ANTHROPIC_BASE_URL/ANTHROPIC_AUTH_TOKEN the dev shell exports (a
// Salesforce gateway that 401s the Managed Agents endpoints).
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

export class AgentSessionError extends Error {}

export interface ManagedSessionStep {
  kind: "text" | "search" | "final" | "error" | "status" | "session";
  detail: string;
}

export type IdleAction = "return" | "refusal" | "wait" | "error";

export function classifyIdle(stop: string | undefined, hasResult: boolean): IdleAction {
  if (stop === "refusal") return "refusal";
  if (hasResult) return "return";
  // requires_action means the session waits on a client event, so keep draining;
  // any other terminal idle (end_turn, retries_exhausted) ended the turn without
  // emitting the final tool.
  return stop === "requires_action" ? "wait" : "error";
}

export interface RunManagedSessionOptions {
  kickoff: string;
  finalToolName: string;
  timeoutMs?: number;
  onStep?: (step: ManagedSessionStep) => void;
}

export interface ManagedSessionResult {
  result: Record<string, unknown>;
  usage: TokenUsageTotals;
}

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

  // Fire before any work runs so the caller captures the id even if the run
  // later throws.
  opts.onStep?.({ kind: "session", detail: session.id });

  // The SDK swallows the abort and ends the iterator cleanly (it does not
  // throw), so track the timeout with a flag and report it after the loop ends.
  const ac = new AbortController();
  const timeoutMs = opts.timeoutMs ?? 600_000;
  let timedOut = false;
  const guard = setTimeout(() => {
    timedOut = true;
    ac.abort();
  }, timeoutMs);

  let cleanExit = false;
  let result: Record<string, unknown> | null = null;
  let usage = emptyUsage();
  try {
    // Stream first, then kick off, or early events are missed.
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
          // Acknowledge every custom tool, not just the final one, or the
          // session parks waiting on us and stalls to the timeout.
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
          const modelUsage = (event as { model_usage?: unknown }).model_usage;
          usage = addUsage(usage, usageFromRaw(modelUsage, 1));
          break;
        }
        case "span.outcome_evaluation_end": {
          // Dead unless a rubric ever attaches to the agent; folded in anyway to
          // keep the totals honest if one does.
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
          if (action === "wait") break;
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

    if (timedOut) throw new AgentSessionError(`research session exceeded ${timeoutMs}ms`);
    if (result) {
      cleanExit = true;
      return { result, usage };
    }
    throw new AgentSessionError("event stream ended without a result");
  } finally {
    clearTimeout(guard);
    // A clean exit retains the session so its event history stays fetchable. A
    // still-running session rejects delete (400), so interrupt before deleting.
    // Never let a cleanup failure mask the real outcome.
    if (!cleanExit) {
      try {
        await c.beta.sessions.events
          .send(session.id, { events: [{ type: "user.interrupt" }] })
          .catch(() => {});
        await c.beta.sessions.delete(session.id);
      } catch (err) {
        opts.onStep?.({
          kind: "error",
          detail: `session cleanup failed: ${(err as Error).message}`,
        });
      }
    }
  }
}

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
