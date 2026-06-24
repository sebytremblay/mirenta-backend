# Mirenta Backend

This service turns one submitted lead into a published, prospect-facing one-pager website. It runs three stages per lead: Research, Build, and Publish. The pipeline stops at a public S3 URL. The [technical design](../mirenta-docs/technical/) holds the rationale behind every choice here.

## Architecture

```
POST /leads ──> Lead Service ──> jobs table ──> Worker tick
                                                   │
                              ┌────────────────────┼────────────────────┐
                              ▼                    ▼                    ▼
                         Research              Build               Publish
                       (agent loop          (agent copy +        (upload to
                        + Exa)               computed ROI         public S3)
                                             -> self-contained
                                             HTML)
```

- **API Gateway** (`src/gateway`) verifies the caller, resolves `org_id` server-side, and routes to the services.
- **Personalization Service** (`src/services/personalization.ts`) owns the product profile and the precondition gate.
- **Lead Service** (`src/services/leads.ts`) creates one job per lead, dedupes at submission, and serves status reads.
- **Worker** (`src/worker`) advances each job through the state machine on a scheduled tick, with a lease, an attempt ceiling, and guarded transitions.
- **Agents** (`src/agents`) run the Research and Website Builder stages.
- **Providers** (`src/providers`) wrap Anthropic, Exa, and S3 behind thin abstractions.

### Where the agent loop runs

The Research Agent runs server-side on Claude Managed Agents. Anthropic hosts the multi-step loop in an ephemeral sandbox, the agent searches through Exa's hosted MCP server, and the worker harvests the structured result from a custom `emit_research` tool. For the MVP the worker drives the session synchronously within one tick; the webhook-driven start, poll, collect split is a fast-follow. The Website Builder runs as a one-shot Messages API call with a forced `tool_choice` on a terminal tool, not a session, since a single structured generation has no multi-step loop for Managed Agents to host. The config pins the host through `MIRENTA_ANTHROPIC_BASE_URL` and ignores the ambient `ANTHROPIC_BASE_URL`, so a dev-shell gateway cannot leak in.

## Stack

- **Runtime:** Node 22+ (the repo runs on Node 25). TypeScript runs directly through Node type-stripping, so no build step exists. Run a file with `node path/to/file.ts`.
- **Database and auth:** Supabase (Postgres plus Auth). RLS stays off for the MVP and tenant isolation runs in application code.
- **Storage:** AWS S3, served from the raw public website endpoint.
- **Models:** Anthropic Claude plus Exa for search and fetch. Models pin to Haiku for the build, read from environment variables.

## Setup

1. Copy `.env.example` to `.env` and fill in the keys. Required: `ANTHROPIC_API_KEY`, `EXA_API_KEY`, `SUPABASE_URL`, `SUPABASE_KEY`. The backend pins the Anthropic host through `MIRENTA_ANTHROPIC_BASE_URL` (default `https://api.anthropic.com`) and ignores the ambient `ANTHROPIC_BASE_URL`, so set `MIRENTA_ANTHROPIC_BASE_URL` only to route through a real proxy (D50). AWS credentials resolve through the standard AWS chain.
2. Install dependencies: `pnpm install`.
3. Apply the migrations in `supabase/migrations/` to the Supabase project (in order).
4. Provision the Managed Agents resources once: `node scripts/provision-managed-agents.ts` creates the persistent research agent, the cloud environment, and the Exa MCP vault credential, and writes their ids (`ANTHROPIC_ENVIRONMENT_ID`, `ANTHROPIC_RESEARCH_AGENT_ID`, `ANTHROPIC_EXA_VAULT_ID`) to `.env`.

## Run

| Command | Purpose |
|---|---|
| `pnpm typecheck` | Type-check the whole tree. |
| `pnpm test` | Run the unit tests (pure logic, no network). |
| `pnpm test:integration` | Run the integration tests against the live database (no agent or S3 calls). |
| `pnpm gateway` | Start the HTTP API on `PORT` (default 8080). |
| `pnpm worker` | Start the worker tick loop. |
| `pnpm pipeline` | Run one lead end to end and print the published URL. |

The smoke scripts in `scripts/` exercise each external dependency on its own (`smoke-db`, `smoke-loop`, `smoke-research`, `smoke-builder`). They make real calls and cost a few cents each.

## API

All routes resolve `org_id` server-side from a verified Supabase session (`Authorization: Bearer <token>`). Outside production, an `x-mirenta-org: <org_id>` header substitutes for local end-to-end runs.

| Method | Route | Purpose |
|---|---|---|
| `POST` | `/profile` | Save the product profile (onboarding). |
| `GET` | `/profile` | Read the product profile. |
| `POST` | `/leads` | Submit leads, or regenerate one with `{ regenerate: true, lead_id }`. Returns `202 { batchId, map }` where `map` keys each `leadId` to its `jobId`. |
| `GET` | `/jobs/{jobId}` | Poll one job: `{ status, url, failureReason }`. |
| `GET` | `/healthz` | Liveness. |

A submission with an incomplete product profile returns `422` with the missing fields.

## Accepted MVP risks

The MVP ships several documented, accepted risks: no row-level security, no prompt-injection guardrails, no spend ceiling, no research-quality gate, no privacy erasure path, the prospect's real brand assets reproduced by URL reference, and no AI disclaimer. The [backlog](../mirenta-docs/technical/BACKLOG.md) tracks each with its trigger. Reconcile them before meaningful external traffic.
