# AI Agent Development Guide

This document provides essential guidelines for AI agents working on this LangGraph FastAPI Agent project.

## Quick Commands

```bash
make install                # Install deps (uv sync) + pre-commit hooks
make dev                    # Dev server with hot reload (port 8000)
make temporal-up            # Local Temporal server + UI (docker-compose) — needed to run the agent loop
make worker                 # Temporal worker: registers ContactLoopWorkflow/TaskExecutionWorkflow + activities
make voice-agent-dev        # Local LiveKit agent (Cloud jobs / Agent Console)
make voice-agent-console    # Local mic/speakers console (no LiveKit room)
make voice-agent-deploy     # Deploy livekit_agent/ to LiveKit Cloud (lk CLI)
make lint                   # ruff check .
make format                 # ruff format .
make typecheck              # uv run pyright (static type check)
make check                  # lint + typecheck
uv run --group test pytest  # run the test suite (pytest isn't in the default sync group)
```

> Run `make help` for the full list of targets.

## Project Structure

```
app/
  api/
    routers/       # Route handlers (all mounted under API_PREFIX, default /api): auth,
                   # organizations (incl. list mine), profiles (GET/PATCH /profiles/me),
                   # contacts, knowledge (org KB CRUD), signals (Twilio SMS
                   # webhook + manual signals), voice (Twilio voice webhook: LiveKit SIP dial + LiveKit agent bootstrap/finalize)
  core/
    config.py      # Settings (env-var based, no pydantic-settings)
    langgraph/     # Per-channel LLM subagents: base.py, sms_graph.py (live), voice_graph.py (legacy), nodes/, tools/
    logging.py     # structlog setup
    limiter.py     # Rate limiting (slowapi, in-memory)
    middleware.py  # ASGI middleware
    prompts/       # Jinja2 prompt templates: sms.md, voice.md, voice_greeting.md
  schemas/         # Pydantic request/response schemas: contacts, knowledge, signals,
                   # tasks, interactions, memory, organizations, profiles, graph state, voice
  services/
    clients/       # External SDK wrappers: supabase, twilio (incl. LiveKit SIP dial TwiML), temporal, livekit (reserved — SIP trunk managed via lk CLI, see livekit_agent/sip/)
    llm/           # LLM registry, retries, circular fallback
    runtimes/      # Reserved (voice moved to livekit_agent/)
    knowledge.py   # Domain helpers (KB fetch + prompt formatting for SMS/voice)
    sms_interaction.py  # Org/contact resolution + STOP/START fast-path
  utils/           # Shared utilities
decision/          # Deterministic decision engine — rules.py, guardrails.py, idempotency.py, engine.py
workflows/         # Temporal workflows — ContactLoopWorkflow (per-contact event loop), TaskExecutionWorkflow (per-task)
activities/        # Temporal activities — contact_store.py, channels.py (Twilio send), interactions.py (LangGraph + KB injection), logging.py
worker/            # Temporal worker entrypoint (`make worker`)
livekit_agent/     # LiveKit Cloud voice agent (Deepgram STT/TTS + OpenAI LLM)
scripts/           # Environment setup scripts
supabase/
  migrations/      # Numbered hand-written schema SQL (no ORM), including 0008_knowledge.sql
  seed/            # Demo/seed data, applied after migrations (e.g. via `supabase db reset`)
tests/
  decision/        # Pure unit tests for the decision engine (no I/O, no clock)
  langgraph/       # Unit tests for graph nodes (e.g. output guardrails)
  services/        # Unit tests mirroring clients/, runtimes/, and domain modules
```

## Project Overview

This is an outreach-agent backend for Mirenta, built with:
- **The Mirenta Runtime** — an event-driven, durable-workflow architecture for agent work spanning days to weeks across voice and SMS. A deterministic decision engine (plain Python, zero LLM calls) decides *when, whether, and on what channel* to act; LLMs only run the conversation itself. **Live end-to-end for SMS** (Twilio webhook → Temporal event bus → decision engine → durable task → knowledge-grounded LangGraph subagent → logged interaction that closes the loop, including a 3-day silence follow-up) **and for inbound voice calls** (Twilio webhook gates DNC/consent, then dials into a LiveKit Cloud SIP trunk when `LIVEKIT_SIP_URI` is configured; the `mirenta-voice` LiveKit agent runs Deepgram STT/TTS + OpenAI LLM; hangup finalize re-enters `ContactLoopWorkflow`). Outbound calling and proactive/first-touch outreach are not implemented yet. See `docs/architecture.md` for the full design and current implementation status.
- **LangGraph** for the stateful SMS interaction-layer subagent (`app/core/langgraph/sms_graph.py`). Voice uses LiveKit Agents' native LLM pipeline (`livekit_agent/`), not LangGraph, on the live call path.
- **FastAPI** for high-performance async REST API endpoints and signal ingestion (webhook routers). The API router is mounted at `settings.API_PREFIX` (default `/api`) in `app/main.py` — route decorators are relative to that prefix (e.g. `@router.post("/webhooks/twilio/sms")` is served at `/api/webhooks/twilio/sms`)
- **Temporal** for durable task scheduling — one long-running `ContactLoopWorkflow` per contact, child `TaskExecutionWorkflow`s per task, timers firing minutes to weeks out. Run `make temporal-up` (local server) and `make worker` (registers workflows/activities) alongside `make dev` to exercise the loop.
- **Langfuse** for LLM observability and tracing
- **Supabase (Postgres + Auth)** for the product domain (`profiles`, `organizations`, `contacts`, `knowledge`), user identity, and the agent-loop tables (`signals`, `tasks`, `interactions`, `contact_memory`)
- **Twilio** for SMS send/receive, voice call answering (webhook → LiveKit SIP dial), and automatic per-org Twilio subaccount + number + Messaging Service provisioning on new-org creation (`app/services/clients/twilio_client.py`)
- **LiveKit Cloud** for the voice agent worker and its inbound SIP trunk/dispatch rule (`livekit_agent/`; deploy with `make voice-agent-deploy`)
- **Deepgram** for streaming STT/TTS inside the LiveKit agent (not called directly from FastAPI)

When working on the decision engine specifically: it must stay free of LLM calls and free of imports from `app/core/langgraph/` — that separation (deterministic core, generative edge) is the architecture's central invariant. Compliance guardrails (contact-frequency caps, DNC, consent) are preconditions that block task *emission*, and are re-checked at task *execution* time — never bolt them on as a post-hoc filter. Quiet-hours deferral helpers exist for future proactive/outbound outreach but do not apply to inbound replies. Live inbound calls are the one path that resolves DNC/consent synchronously in the webhook rather than through the decision engine — see `docs/architecture.md`'s voice-webhook section for why.

Known gaps if you're picking up related work (see `docs/architecture.md#component-status` for details): no outbound calling, no proactive/first-touch outreach, and no voice equivalent of SMS's STOP/START opt-out handling. A 3-day SMS silence follow-up (and cancel-on-inbound) is already live. Voice grounds on org knowledge via the LiveKit agent bootstrap endpoint.

## Quick Reference: Critical Rules

### Import Rules
- **All imports MUST be at the top of the file** - never add imports inside functions or classes

### Logging Rules
- Use **structlog** for all logging
- Log messages must be **lowercase_with_underscores** (e.g., `"user_login_successful"`)
- **NO f-strings in structlog events** - pass variables as kwargs
- Use `logger.exception()` instead of `logger.error()` to preserve tracebacks
- Example: `logger.info("contact_created", org_id=str(org_id), user_id=str(user.id))`

### Retry Rules
- **Always use tenacity library** for retry logic
- Configure with exponential backoff
- Example: `@retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=4, max=10))`

### Output Rules
- **Always enable rich library** for formatted console outputs
- Use rich for progress bars, tables, panels, and formatted text

### FastAPI Rules
- All routes must have rate limiting decorators
- Use dependency injection for services, database connections, and auth
- All database operations must be async

## Code Style Conventions

### Python/FastAPI
- Use `async def` for asynchronous operations
- Use type hints for all function signatures
- Prefer Pydantic models over raw dictionaries
- Use functional, declarative programming; avoid classes except for services and agents
- File naming: lowercase with underscores (e.g., `user_routes.py`)
- Use the RORO pattern (Receive an Object, Return an Object)

### Error Handling
- Handle errors at the beginning of functions
- Use early returns for error conditions
- Place the happy path last in the function
- Use guard clauses for preconditions
- Use `HTTPException` for expected errors with appropriate status codes

## LangGraph & LangChain Patterns

### Graph Structure
- Use `StateGraph` for building AI agent workflows
- Define clear state schemas using Pydantic models (see `app/schemas/graph.py`)
- Use `CompiledStateGraph` for production workflows
- Implement `AsyncPostgresSaver` for checkpointing and persistence
- Use `Command` for controlling graph flow between nodes

### Tracing
- Use LangChain's `CallbackHandler` from Langfuse for tracing all LLM calls
- All LLM operations must have Langfuse tracing enabled

## Authentication & Security

- User identity is Supabase Auth — clients sign up/log in directly against Supabase; this backend only verifies the resulting JWT (`verify_supabase_token`)
- Use `get_current_user` for every authenticated endpoint (see `app/api/routers/auth.py`) — there is no separate backend-issued token type
- Store sensitive data (including Supabase keys) in environment variables
- Validate all user inputs with Pydantic models

## Database Operations

- Everything lives in one Supabase Postgres project: `auth.users` (Supabase-managed), the hand-written RLS product domain (`profiles`, `organizations`, `contacts`, `knowledge`), and the agent-loop tables (`signals`, `tasks`, `interactions`, `contact_memory`) — see `docs/database.md`
- Use the Supabase client (`app/services/clients/supabase_client.py`, `get_user_client`/`get_service_role_client`/`execute_query`) for all table access — there is no ORM
- Agent-loop tables (`signals`, `tasks`, `interactions`, `contact_memory`, `contacts`, `contact_state`, `consent`, `organization_twilio_secrets`) have RLS enabled with no policies — they're reachable only via `get_service_role_client()`, never the user-scoped client
- Dashboard bootstrap after login: `GET /organizations` lists the caller's orgs (do not stash `org_id` in the JWT); `GET`/`PATCH /profiles/me` owns display name + `onboarding_completed`
- `profiles` is own-row only (RLS); `knowledge` is member-readable / admin-writable (`is_org_member` / `is_org_admin`); the SMS interaction activity loads active knowledge via the service-role client and injects it into compose
- `consent` is append-only — write a new row to revoke or re-grant, never update an existing row in place; guardrails read the latest row via the `current_consent` view
- `tasks.idempotency_key` must be derived deterministically by the decision engine so retries can't double-emit a task; never generate it from a random value or wall-clock time
- LangGraph's `AsyncPostgresSaver` checkpoints SMS and voice subagents already (same Supabase Postgres connection, its own `checkpoint*` tables) — extend this pattern for any new channel subagent rather than inventing new state storage
- Temporal owns its own persistence for workflow/task scheduling state (`app/services/clients/temporal_client.py`, `workflows/`) — don't reimplement a poller/scheduler in application code

## Performance Guidelines

- Minimize blocking I/O operations
- Use async for all database and external API calls
- Use connection pooling for database connections
- Optimize LLM calls with streaming responses

## Observability

- Integrate Langfuse for LLM tracing on all agent operations
- Use structured logging with context binding (request_id, user_id)
- **Debugging a live call or SMS?** Use the `debug-agent-session` skill (`.agents/skills/debug-agent-session/`). It resolves a customer report (phone, time, Call SID, name) to one `contact_id` and pulls the trace across Supabase, Temporal, LiveKit, Langfuse, and Render. See `docs/observability.md#debugging-a-live-agent-session`.

## Configuration Management

- Use environment-specific configuration files (`.env.development`, `.env.staging`, `.env.production`)
- Use Pydantic Settings for type-safe configuration (see `app/core/config.py`)
- Never hardcode secrets or API keys

## Key Dependencies

- **FastAPI** - Web framework
- **LangGraph** - Agent workflow orchestration
- **LangChain** - LLM abstraction and tools
- **Langfuse** - LLM observability and tracing
- **Pydantic v2** - Data validation and settings
- **structlog** - Structured logging
- **Supabase (Postgres + Auth)** - Database and user identity
- **tenacity** - Retry logic
- **rich** - Terminal formatting
- **slowapi** - Rate limiting

## 10 Commandments for This Project

1. All routes must have rate limiting decorators
2. All LLM operations must have Langfuse tracing
3. All async operations must have proper error handling
4. All logs must follow structured logging format with lowercase_underscore event names
5. All retries must use tenacity library
6. All console outputs should use rich formatting
7. All imports must be at the top of files
8. All database operations must be async
9. All endpoints must have proper type hints and Pydantic models
10. All code must pass `make typecheck` (pyright standard mode)

## Common Pitfalls to Avoid

- ❌ Using f-strings in structlog events
- ❌ Adding imports inside functions
- ❌ Forgetting rate limiting decorators on routes
- ❌ Missing Langfuse tracing on LLM calls
- ❌ Using `logger.error()` instead of `logger.exception()` for exceptions
- ❌ Blocking I/O operations without async
- ❌ Hardcoding secrets or API keys
- ❌ Missing type hints on function signatures

## When Making Changes

Before modifying code:
1. Read the existing implementation first
2. Check for related patterns in the codebase
3. Ensure consistency with existing code style
4. Add appropriate logging with structured format
5. Include error handling with early returns
6. Add type hints and Pydantic models
7. Verify Langfuse tracing is enabled for LLM calls

## References

- LangGraph Documentation: https://langchain-ai.github.io/langgraph/
- LangChain Documentation: https://python.langchain.com/docs/
- FastAPI Documentation: https://fastapi.tiangolo.com/
- Langfuse Documentation: https://langfuse.com/docs
