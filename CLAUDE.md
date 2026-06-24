# CLAUDE.md

Guidance for Claude Code in the Mirenta backend. The repo-root `CLAUDE.md` covers the product framing, working principles, and writing style; this file adds only the backend-specific detail.

## What this repo is

The backend service and its setup (env, preflight, provisioning docs) live at the repository root.

## Cost discipline

Run the full pipeline sparingly: each invocation of the Research Agent and the Website Builder spends real money. To exercise behavior alone, where the final output does not matter, point at a cheaper model and short-circuit the call so no live generation runs.

## Anthropic integration: Claude Managed Agents

The backend runs the **Research Agent** on **Claude Managed Agents**, a real Anthropic product. The **Website Builder** runs a one-shot Messages API call, not a session, since a single structured generation has no multi-step loop for Managed Agents to host. Read this before reasoning about the agent integration.

- Managed Agents runs the orchestration loop **server-side** on Anthropic infrastructure. The model, system prompt, tools, MCP servers, and skills define an **Agent** (referenced by id). An **Environment** sets where sessions run: an Anthropic-managed cloud sandbox (the MVP path) or a self-hosted sandbox on your own infrastructure. A **Session** is one running agent instance, created against an agent and environment, with event history persisted server-side.
- The research agent, the cloud environment, and the Exa MCP vault credential are persistent: `scripts/provision-managed-agents.ts` creates them once and writes their ids to `.env` (`ANTHROPIC_ENVIRONMENT_ID`, `ANTHROPIC_RESEARCH_AGENT_ID`, `ANTHROPIC_EXA_VAULT_ID`). The worker creates a session against them, drives it to the `emit_research` result, and collects. For the MVP the worker holds the session open **synchronously within one tick**; the webhook-driven short-tick start/poll/collect split is a fast-follow.
- The agent searches through **Exa's hosted MCP server** (`https://mcp.exa.ai/mcp`), authenticated by a vaulted `static_bearer` credential keyed to that URL. The MCP toolset must be `always_allow` or the session parks at `idle (requires_action)` awaiting a per-call confirmation.
- The SDK is the standard **`@anthropic-ai/sdk`** (`client.beta.agents`, `client.beta.sessions`, `client.beta.environments`, `client.beta.vaults`). It sets the beta header `managed-agents-2026-04-01` automatically. Managed Agents is in beta and enabled by default on API accounts.
- **The key is a genuine first-party Anthropic key, and Managed Agents is reachable.** A prior session wrongly concluded otherwise because the dev shell exports `ANTHROPIC_BASE_URL` (a Salesforce browser-auth gateway that 401s the Managed Agents endpoints) plus `ANTHROPIC_AUTH_TOKEN`, both of which the SDK inherits from the ambient environment. The config pins the host through `MIRENTA_ANTHROPIC_BASE_URL` (default `https://api.anthropic.com`) and ignores the ambient `ANTHROPIC_BASE_URL`, so the gateway cannot leak in. See the [[mirenta-managed-agents-reachable]] memory.
- Docs: https://platform.claude.com/docs/en/managed-agents/overview and https://platform.claude.com/docs/en/managed-agents/self-hosted-sandboxes

**Do not confuse Managed Agents with `@anthropic-ai/claude-agent-sdk`.** That second package is a different product: the Claude Code Agent SDK, which spawns a local CLI subprocess and runs the loop **in-process** on the caller's machine. It is not what this backend uses. A prior session conflated the two, concluded that hosted sessions did not exist, and raised a false conflict between Realtime mode and the short-tick worker. The conflict is not real: Anthropic holds the loop, so a short-tick worker pairs with Realtime correctly.
