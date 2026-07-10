# Mirenta Backend

The API backend for Mirenta — a general-purpose outreach runtime. Any organization (a clinic, a dealership, a sales team, an agency — whatever) imports a contact list, and an AI agent runs outreach across SMS, voice, and email over days-to-weeks-long campaigns, working each contact toward a goal the org defines — booking an appointment, scheduling a call, closing a deal, or anything else.

Built with **FastAPI** on top of **Supabase** (Postgres + Auth, RLS-enforced). Outreach itself runs on the **Takeoff Runtime** — an event-driven, durable-workflow agent-loop architecture: deterministic code decides *when, whether, and on what channel* to reach a contact; LLMs (LangGraph subagents) only handle the conversation itself. See [docs/architecture.md](docs/architecture.md).

---

## What's included

- **Product-domain API** — organizations (with automatic Twilio number provisioning), contacts
- **The Takeoff Runtime agent loop, live for SMS** — Twilio SMS webhook → Temporal event bus → deterministic decision engine → durable task scheduling → LangGraph SMS subagent → logged interaction that closes the loop
- **Agent-loop data model** — `signals` (inbound events), `tasks` (scheduled outreach), `interactions` (subagent conversations), `contact_memory` (semantic recall) — the durable backbone of the Takeoff Runtime loop
- **Temporal** durable workflows — one long-running `ContactLoopWorkflow` per contact, child `TaskExecutionWorkflow`s per task, guardrails re-checked at execution time
- **Supabase Auth** JWT verification — clients sign up/log in directly against Supabase; this backend only verifies the resulting token
- **Row Level Security** on every table — dashboard tables scope reads to the caller's org membership; agent-loop tables are locked to the service role
- **LangGraph** SMS subagent (compose → deterministic output-guardrails loop) with Postgres checkpointing and tool calling
- **LLM service** with circular model fallback, exponential backoff retries, and a total timeout budget
- **Langfuse** tracing on all LLM calls
- **Structured logging** (structlog) with request/user context on every line
- **Rate limiting** via slowapi on every route

> **Status.** The loop runs end-to-end for **SMS only** — inbound text in, LLM-drafted reply out, multi-turn, guardrailed, logged. Voice and email have schema support (signal/task types) but no ingestion route, execution path, or subagent yet. There's also no proactive/first-touch outreach, no auto-follow-up after silence, and no cancellation of a scheduled task that a newer signal makes stale. See [docs/architecture.md](docs/architecture.md#component-status) for the full breakdown.

## Quickstart

```bash
git clone <repo-url> mirenta-backend && cd mirenta-backend
cp .env.example .env.development   # fill in Supabase + LLM keys
make install
make dev                           # starts the API on port 8000
```

Open [http://localhost:8000/docs](http://localhost:8000/docs) to see the interactive API.

To run the full agent loop (not just the CRUD API), also start Temporal and a worker:

```bash
make temporal-up                   # local Temporal server + UI (docker-compose)
make worker                        # registers ContactLoopWorkflow/TaskExecutionWorkflow, runs alongside the API
```

> See [docs/getting-started.md](docs/getting-started.md) for full setup details, including provisioning the Supabase project and its SQL schema.

## Documentation

| Guide                                      | What it covers                                       |
| ------------------------------------------ | ----------------------------------------------------- |
| [Getting Started](docs/getting-started.md) | Prerequisites, Supabase setup, first API call         |
| [Architecture](docs/architecture.md)       | System design, request flow, component diagrams       |
| [Configuration](docs/configuration.md)     | All environment variables with defaults                |
| [Authentication](docs/authentication.md)   | Supabase JWT flow, endpoint reference                  |
| [Database](docs/database.md)               | Schema (organizations, contacts, signals, tasks, interactions, memory), RLS |
| [LLM Service](docs/llm-service.md)         | Models, retries, fallback, timeout budget              |
| [Observability](docs/observability.md)     | Langfuse, structured logging                           |

## Project structure

```
app/
  api/
    routers/       # Route handlers: auth, organizations, contacts, signals (SMS webhook)
  core/
    langgraph/     # Per-channel LLM subagents (sms_graph.py live, voice_graph.py stub) + tools
    prompts/       # System prompt template
    config.py      # Settings
    middleware.py  # Logging context
    limiter.py     # Rate limiting
  schemas/         # Pydantic request/response schemas (contacts, signals,
                   # tasks, interactions, memory, organizations, ...)
  services/
    supabase_client.py  # RLS-scoped and service-role Supabase clients
    temporal_client.py  # Cached Temporal workflow client
    twilio_client.py    # Outbound SMS + number provisioning
    llm/                # LLM registry, retries, fallback
decision/           # Deterministic decision engine: rules, guardrails, idempotency
workflows/          # Temporal workflows: ContactLoopWorkflow, TaskExecutionWorkflow
activities/          # Temporal activities: contact_store, channels, interactions, logging
worker/              # Temporal worker entrypoint (make worker)
```

## Data model

Everything lives in one Supabase Postgres project, as numbered SQL migrations in `supabase/migrations/` (no ORM):

- `organizations` — any org running outreach (clinic, dealership, agency, etc.), with `organization_members` for staff and roles
- `contacts` — the people an org is reaching out to, sourced from an external import (CRM export, spreadsheet, PMS, etc.), with 1:1 `contact_state` (decision-engine workflow state) and append-only `consent` records
- `signals` — everything that kicks off or re-enters the agent loop: inbound webhooks, replies, and completed interactions
- `tasks` — scheduled outreach emitted by the deterministic decision engine, with idempotency keys and provenance back to the triggering signal
- `interactions` — logged subagent conversations (voice/SMS/email), summarized back into `contact_memory`
- `contact_memory` — embedded summaries/facts for semantic recall (pgvector)

See [docs/database.md](docs/database.md) for the full schema, indexes, and RLS policy table, and [docs/architecture.md](docs/architecture.md) for how these tables implement the agent loop.

## Contributing

PRs welcome. Please read [docs/getting-started.md](docs/getting-started.md) to get your environment set up, then follow the coding conventions in [AGENTS.md](AGENTS.md).

Report security issues privately — see [SECURITY.md](SECURITY.md).

## License

See [LICENSE](LICENSE).

## FAQ

### General

**What is this?**
The backend API for Mirenta, a general-purpose outreach runtime — not tied to any one vertical. It exposes the product domain (organizations, contacts) over a Supabase-authenticated REST API, and runs the Takeoff Runtime agent loop that drives outreach for any kind of organization — live for SMS today, with voice/email still to come.

**What's the Takeoff Runtime?**
An event-driven architecture where a deterministic decision engine (not an LLM) decides when/whether/how to contact someone, Temporal schedules the resulting tasks durably, and LangGraph subagents handle only the actual conversation on each channel. See [docs/architecture.md](docs/architecture.md) for the full design.

**Is the outreach agent live?**
Yes, for SMS: text a configured Twilio number and you'll get a real, context-aware, guardrailed LLM reply — inbound webhook → Temporal event bus → decision engine → durable task → LangGraph SMS subagent → logged interaction that re-enters the loop. Voice and email aren't wired up yet (schema exists, no ingestion route or subagent), and the decision engine doesn't yet do proactive outreach or auto-follow-up — see [docs/architecture.md](docs/architecture.md#component-status) for the full breakdown.

### Setup & Configuration

**Which LLM providers are supported?**
OpenAI-compatible endpoints only, via the `LLMRegistry` in `app/services/llm/registry.py`. Configure your model via `DEFAULT_LLM_MODEL` in `.env.development`. See [docs/llm-service.md](docs/llm-service.md).

**Do I need Langfuse?**
No. Set `LANGFUSE_TRACING_ENABLED=false` to disable tracing entirely; structured logs still capture request/user context.

### Development

**How do I add a custom tool for the agent?**
Drop a LangChain `@tool`-decorated function in `app/core/langgraph/tools/` and register it in the `tools` list exported from that package.

**How does the LLM service handle failures?**
Two layers: (1) per-call exponential-backoff retry via `tenacity`, (2) **circular fallback** — if the active model exhausts its retries, the service rotates to the next model in `LLMRegistry` and continues. A total timeout budget caps the whole call. See [docs/llm-service.md](docs/llm-service.md).

### Troubleshooting

**The API won't start**

- Confirm `.env.development` exists — copy from `.env.example` and fill in required keys
- Confirm `SUPABASE_DB_*` vars match your Supabase project's connection string and that outbound access to Supabase is allowed

**401 from any Supabase-gated route**
Make sure you're sending a Supabase `access_token` (not a backend-issued token — there is no such thing), and that `SUPABASE_JWKS_URL` matches the JWKS endpoint in Project Settings → API. See [docs/authentication.md](docs/authentication.md).

**Rate limiting is too aggressive**
Limits are defined in `app/core/limiter.py` (slowapi). Adjust per-route decorators or the default rate in that file. See [docs/configuration.md](docs/configuration.md) for related env vars.
