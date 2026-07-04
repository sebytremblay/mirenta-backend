# Mirenta Backend

The API backend for Mirenta — a clinic outreach platform. Clinics import their patient recall list, and an AI agent runs SMS/voice conversations to bring lapsed patients back in for care, booking appointments along the way.

Built with **FastAPI** on top of **Supabase** (Postgres + Auth, RLS-enforced), with a **LangGraph** agent kept in the codebase as infra for outreach message generation.

---

## What's included

- **Product-domain API** — organizations (clinics), knowledge, contacts, conversations, appointments
- **Supabase Auth** JWT verification — clients sign up/log in directly against Supabase; this backend only verifies the resulting token
- **Row Level Security** on every table — the dashboard sees only what the caller's org membership allows; application code never re-implements authorization
- **LangGraph** stateful agent with checkpointing and tool calling — kept as infra for outreach message generation, not yet wired to an endpoint
- **LLM service** with circular model fallback, exponential backoff retries, and a total timeout budget
- **Langfuse** tracing on all LLM calls
- **Structured logging** (structlog) with request/user context on every line
- **Rate limiting** via slowapi on every route

## Quickstart

```bash
git clone <repo-url> mirenta-backend && cd mirenta-backend
cp .env.example .env.development   # fill in Supabase + LLM keys
make install
make dev                           # starts the API on port 8000
```

Open [http://localhost:8000/docs](http://localhost:8000/docs) to see the interactive API.

> See [docs/getting-started.md](docs/getting-started.md) for full setup details, including provisioning the Supabase project and its SQL schema.

## Documentation

| Guide                                      | What it covers                                       |
| ------------------------------------------ | ----------------------------------------------------- |
| [Getting Started](docs/getting-started.md) | Prerequisites, Supabase setup, first API call         |
| [Architecture](docs/architecture.md)       | System design, request flow, component diagrams       |
| [Configuration](docs/configuration.md)     | All environment variables with defaults                |
| [Authentication](docs/authentication.md)   | Supabase JWT flow, endpoint reference                  |
| [Database](docs/database.md)               | Schema (clinics, contacts, conversations, appointments), RLS |
| [LLM Service](docs/llm-service.md)         | Models, retries, fallback, timeout budget              |
| [Observability](docs/observability.md)     | Langfuse, structured logging                           |

## Project structure

```
app/
  api/v1/          # Route handlers: auth, organizations, knowledge,
                   # contacts, conversations, appointments
  core/
    langgraph/     # Agent graph + tools (not yet wired to a route)
    prompts/       # System prompt template
    config.py      # Settings
    middleware.py  # Logging context
    limiter.py     # Rate limiting
  schemas/         # Pydantic request/response schemas
  services/        # LLM service, Supabase client
```

## Data model

Everything lives in one Supabase Postgres project, as hand-written SQL run through the Supabase SQL editor (no ORM, no migration tooling):

- `organizations` — a clinic or clinic group, with `organization_members` for staff and roles
- `knowledge` — free-form clinic knowledge (hours, pricing, policies) the agent draws on
- `contacts` — patients on a clinic's recall list, sourced from a PMS export; TCPA opt-out is tracked per contact
- `conversations` — one outreach campaign/window of interaction with a contact, logging `messages` (SMS) and `call_sessions`/`call_transcripts` (voice)
- `appointments` — the billable outcome of a conversation

See [docs/database.md](docs/database.md) for the full schema, indexes, and RLS policy table.

## Contributing

PRs welcome. Please read [docs/getting-started.md](docs/getting-started.md) to get your environment set up, then follow the coding conventions in [AGENTS.md](AGENTS.md).

Report security issues privately — see [SECURITY.md](SECURITY.md).

## License

See [LICENSE](LICENSE).

## FAQ

### General

**What is this?**
The backend API for Mirenta, a clinic outreach platform. It exposes the product domain (clinics, contacts, conversations, appointments) over a Supabase-authenticated REST API, and includes a LangGraph agent kept as infra for generating outreach messages.

**Is the outreach agent live?**
Not yet. The agent graph (`app/core/langgraph/graph.py`) is built and testable in isolation but isn't wired to an API route — see [docs/architecture.md](docs/architecture.md).

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
Make sure you're sending a Supabase `access_token` (not a backend-issued token — there is no such thing), and that `SUPABASE_JWT_SECRET` matches the JWT Secret in Project Settings → API. See [docs/authentication.md](docs/authentication.md).

**Rate limiting is too aggressive**
Limits are defined in `app/core/limiter.py` (slowapi). Adjust per-route decorators or the default rate in that file. See [docs/configuration.md](docs/configuration.md) for related env vars.
