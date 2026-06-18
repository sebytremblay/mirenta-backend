# Mirenta Backend

This service turns one submitted lead into a published, prospect-facing one-pager website. It runs three stages per lead: Research, Build, and Publish. The pipeline stops at a public S3 URL. The [decision record](../DECISIONS.md) and the [technical design](../mirenta-docs/technical/) hold the rationale behind every choice here.

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

### The agent loop runs in-process

The design targets Claude Managed Agents (D9, D13), which hold the agent loop server-side. The provided API key routes through a gateway that does not expose Managed Agents, so the worker runs the loop in-process through the Messages API instead (D45). The model emits tool calls, the worker executes them (Exa search, quote re-fetch), and a forced `tool_choice` on a terminal tool returns the structured result. The pipeline, the durability layer, and the realtime posture stay unchanged; only the location of the loop moved. See the [decision record](../DECISIONS.md) D45 through D47 and the team memory note on the gateway.

## Stack

- **Runtime:** Node 22+ (the repo runs on Node 25). TypeScript runs directly through Node type-stripping, so no build step exists. Run a file with `node path/to/file.ts`.
- **Database and auth:** Supabase (Postgres plus Auth). RLS stays off for the MVP and tenant isolation runs in application code (D30).
- **Storage:** AWS S3, served from the raw public website endpoint (D16, D29).
- **Models:** Anthropic Claude plus Exa for search and fetch. Models pin to Haiku for the build (D47), read from environment variables.

## Setup

1. Copy `.env.example` to `.env` and fill in the keys. Required: `ANTHROPIC_API_KEY`, `EXA_API_KEY`, `SUPABASE_URL`, `SUPABASE_KEY`. Set `ANTHROPIC_BASE_URL` when the key routes through a gateway. AWS credentials resolve through the standard AWS chain.
2. Install dependencies: `pnpm install`.
3. Apply the migrations in `supabase/migrations/` to the Supabase project (in order).

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
| `POST` | `/leads` | Submit leads, or regenerate one with `{ regenerate: true, lead_id }` (D44). Returns `202 { batchId, map }` where `map` keys each `leadId` to its `jobId` (D15). |
| `GET` | `/jobs/{jobId}` | Poll one job: `{ status, url, failureReason }`. |
| `GET` | `/healthz` | Liveness. |

A submission with an incomplete product profile returns `422` with the missing fields (D14).

## Accepted MVP risks

The MVP ships several documented, accepted risks: no row-level security (D30), no prompt-injection guardrails (D31), no spend ceiling (D33), no research-quality gate (D36), no privacy erasure path (D41), inlined real brand assets (D42), and no AI disclaimer (D43). The [backlog](../mirenta-docs/technical/BACKLOG.md) tracks each with its trigger. Reconcile them before meaningful external traffic.
