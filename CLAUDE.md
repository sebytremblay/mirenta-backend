# CLAUDE.md

Guidance for Claude Code when working in the Mirenta backend repository.

## What this repo is

Mirenta turns a lead list into one hyper-personalized one-pager website per prospect. This repository holds the backend track. The frontend and go-to-market track belong to a co-founder.

- The backend service and its setup (env, preflight, provisioning docs) live at the repository root.
- `DECISIONS.md` and `OPEN_DECISIONS.md` record the resolved and open system-design decisions.

## Anthropic integration: Claude Managed Agents

The backend runs both agents (Research Agent and Website Builder) on **Claude Managed Agents**, a real Anthropic product. Read this before reasoning about the agent integration.

- Managed Agents runs the orchestration loop **server-side** on Anthropic infrastructure. The model, system prompt, tools, MCP servers, and skills define an **Agent** (referenced by id). An **Environment** sets where sessions run: an Anthropic-managed cloud sandbox (the MVP path) or a self-hosted sandbox on your own infrastructure. A **Session** is one running agent instance, created against an agent and environment, with event history persisted server-side.
- The lifecycle is start, poll, collect: create the agent and environment once, then `client.beta.sessions.create({ agent, environment_id })` starts a session, and the worker polls and collects the result on a later tick. No agent loop runs inside Mirenta's own compute. This is why the worker can run as a short scheduled tick (D13, D32).
- The SDK is the standard **`@anthropic-ai/sdk`** (`client.beta.sessions`, `client.beta.environments`). It sets the beta header `managed-agents-2026-04-01` automatically. Managed Agents is in beta and enabled by default on API accounts.
- The MVP cloud-sandbox path needs only `ANTHROPIC_API_KEY`. Self-hosted sandboxes add `ANTHROPIC_ENVIRONMENT_ID` and `ANTHROPIC_ENVIRONMENT_KEY` and a worker process.
- Docs: https://platform.claude.com/docs/en/managed-agents/overview and https://platform.claude.com/docs/en/managed-agents/self-hosted-sandboxes

**Do not confuse Managed Agents with `@anthropic-ai/claude-agent-sdk`.** That second package is a different product: the Claude Code Agent SDK, which spawns a local CLI subprocess and runs the loop **in-process** on the caller's machine. It is not what this backend uses. A prior session conflated the two, concluded that hosted sessions did not exist, and raised a false conflict between Realtime mode (D7) and the short-tick worker (D32). The conflict is not real: Anthropic holds the loop, so a short-tick worker pairs with Realtime correctly.

## Working principles learned here

- **Verify a load-bearing claim before acting on it. Never conclude a feature does not exist from the absence of one doc page.** Search the official docs (`platform.claude.com`, `code.claude.com`) and read the actual reference. If a background research agent goes silent, verify the fact yourself rather than treating silence as evidence.
- **Stay inside the scope the user set.** Setup is not implementation. Do not write the application's architecture (domain schemas, adapters, migrations, framework choices) or its tests when the task is to provision and verify the external services. Tests and design belong to the implementation phase, and pre-writing them corners the implementation agent. When in doubt about scope, ask.

## Decision record discipline

The decisions in `DECISIONS.md` are settled. When work touches a decision, cite its id (for example D13, D32, D35). Open items live in `OPEN_DECISIONS.md`. Surface a new conflict as an open decision rather than resolving it unilaterally.

## Writing style

Follow the house style in all docs, comments, and communications: no contractions, active voice, present tense, strong verbs, no weak openers, no em dashes.
