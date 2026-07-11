# AI Agent Development Guide

This document provides essential guidelines for AI agents working on this LangGraph FastAPI Agent project.

## Quick Commands

```bash
make install                # Install deps (uv sync) + pre-commit hooks
make dev                    # Dev server with hot reload (port 8000)
make temporal-up            # Local Temporal server + UI (docker-compose) — needed to run the agent loop
make worker                 # Temporal worker: registers ContactLoopWorkflow/TaskExecutionWorkflow + activities
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
    routers/       # Route handlers (auth.py, organizations.py, contacts.py, signals.py [Twilio SMS webhook + manual signals])
  core/
    config.py      # Settings (env-var based, no pydantic-settings)
    langgraph/     # Per-channel LLM subagents: base.py (shared plumbing), sms_graph.py (live), voice_graph.py (stub, not wired), nodes/, tools/
    logging.py     # structlog setup
    limiter.py     # Rate limiting (slowapi, in-memory)
    middleware.py  # ASGI middleware
    prompts/       # System prompts
  schemas/         # Pydantic request/response schemas: contacts, signals,
                   # tasks, interactions, memory, organizations, graph state
  services/        # LLM service, Supabase client, Temporal client, Twilio client (send + number provisioning)
  utils/           # Shared utilities
decision/          # Deterministic decision engine — rules.py, guardrails.py, idempotency.py, engine.py
workflows/         # Temporal workflows — ContactLoopWorkflow (per-contact event loop), TaskExecutionWorkflow (per-task)
activities/        # Temporal activities — contact_store.py, channels.py (Twilio send), interactions.py (LangGraph invocation), logging.py
worker/            # Temporal worker entrypoint (`make worker`)
scripts/           # Environment setup scripts
supabase/
  migrations/      # Numbered hand-written SQL (no ORM)
tests/
  decision/        # Pure unit tests for the decision engine (no I/O, no clock)
  langgraph/       # Unit tests for graph nodes (e.g. output guardrails)
  services/        # Unit tests for services with mocked external clients (e.g. Twilio)
```

## Project Overview

This is an outreach-agent backend for Mirenta, built with:
- **The Takeoff Runtime** — an event-driven, durable-workflow architecture for agent work spanning days to weeks across voice, SMS, and email. A deterministic decision engine (plain Python, zero LLM calls) decides *when, whether, and on what channel* to act; LLMs only run the conversation itself. **Live end-to-end for SMS today** — Twilio webhook → Temporal event bus → decision engine → durable task → LangGraph subagent → logged interaction that closes the loop. Voice/email and proactive/follow-up rules are not implemented yet. See `docs/architecture.md` for the full design and current implementation status.
- **LangGraph** for the stateful, multi-step interaction-layer subagents. `app/core/langgraph/sms_graph.py` (a `compose -> output_guardrails` loop) is wired to the interaction layer and runs on every SMS task; `voice_graph.py` exists but isn't call-capable yet; there's no email subagent.
- **FastAPI** for high-performance async REST API endpoints and signal ingestion (webhook routers)
- **Temporal** for durable task scheduling — one long-running `ContactLoopWorkflow` per contact, child `TaskExecutionWorkflow`s per task, timers firing minutes to weeks out. Run `make temporal-up` (local server) and `make worker` (registers workflows/activities) alongside `make dev` to exercise the loop.
- **Langfuse** for LLM observability and tracing
- **Supabase (Postgres + Auth)** for the product domain, user identity, and the agent-loop tables (`signals`, `tasks`, `interactions`, `contact_memory`)
- **Twilio** for SMS send/receive and automatic phone-number provisioning on new-org creation (`app/services/twilio_client.py`)

When working on the decision engine specifically: it must stay free of LLM calls and free of imports from `app/core/langgraph/` — that separation (deterministic core, generative edge) is the architecture's central invariant. Compliance guardrails (quiet hours, contact-frequency caps, DNC, consent) are preconditions that block task *emission*, and are re-checked at task *execution* time — never bolt them on as a post-hoc filter.

Known gaps if you're picking up related work (see `docs/architecture.md#component-status` for details): no proactive/first-touch outreach, no auto-follow-up after silence, and no cancellation of a scheduled task when a newer signal makes it stale.

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

- Everything lives in one Supabase Postgres project: `auth.users` (Supabase-managed), the hand-written RLS product domain (`organizations`, `contacts`), and the agent-loop tables (`signals`, `tasks`, `interactions`, `contact_memory`) — see `docs/database.md`
- Use the Supabase client (`app/services/supabase_client.py`, `get_user_client`/`get_service_role_client`/`execute_query`) for all table access — there is no ORM
- Agent-loop tables (`signals`, `tasks`, `interactions`, `contact_memory`, `contacts`, `contact_state`, `consent`) have RLS enabled with no policies — they're reachable only via `get_service_role_client()`, never the user-scoped client
- `consent` is append-only — write a new row to revoke or re-grant, never update an existing row in place; guardrails read the latest row via the `current_consent` view
- `tasks.idempotency_key` must be derived deterministically by the decision engine so retries can't double-emit a task; never generate it from a random value or wall-clock time
- LangGraph's `AsyncPostgresSaver` checkpoints the SMS subagent already (same Supabase Postgres connection, its own `checkpoint*` tables) — extend this pattern for any new channel subagent rather than inventing new state storage
- Temporal owns its own persistence for workflow/task scheduling state (`app/services/temporal_client.py`, `workflows/`) — don't reimplement a poller/scheduler in application code

## Performance Guidelines

- Minimize blocking I/O operations
- Use async for all database and external API calls
- Use connection pooling for database connections
- Optimize LLM calls with streaming responses

## Observability

- Integrate Langfuse for LLM tracing on all agent operations
- Use structured logging with context binding (request_id, user_id)

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
