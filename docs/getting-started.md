# Getting Started

## Prerequisites

- Python 3.13+
- [uv](https://docs.astral.sh/uv/) — `pip install uv`
- A [Supabase](https://supabase.com) project (free tier is fine) — provides Postgres and Auth
- OpenAI API key
- Langfuse account (optional — set `LANGFUSE_TRACING_ENABLED=false` to skip)

## Set up your Supabase project

1. Create a project at [supabase.com](https://supabase.com).
2. From **Project Settings → API**, copy the Project URL, publishable key, secret key, and JWKS URL.
3. From **Project Settings → Database → Connection string**, copy the direct connection host/port/user/password.
4. Run the migrations in `supabase/migrations/` in order (`0001` through `0007`) via the Supabase SQL editor or CLI — see `docs/database.md` for what each one adds.

## Run locally

```bash
git clone <repo-url> my-agent
cd my-agent

cp .env.example .env.development
# Required: OPENAI_API_KEY, SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY,
#           SUPABASE_SECRET_KEY, SUPABASE_JWKS_URL, SUPABASE_DB_*
# Optional: LANGFUSE_* keys (or set LANGFUSE_TRACING_ENABLED=false)

make install       # installs deps + pre-commit hooks
make dev           # starts server with hot reload on port 8000
```

Open [http://localhost:8000/docs](http://localhost:8000/docs).

## Your first API call

User identity is Supabase Auth — this backend never issues a user token itself. Sign up/log in directly against the Supabase Auth REST API (or a Supabase client SDK) to get an access token.

### 1. Sign up via Supabase Auth

```bash
curl -X POST "$SUPABASE_URL/auth/v1/signup" \
  -H "apikey: $SUPABASE_PUBLISHABLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"email": "you@example.com", "password": "Secret123!"}'  # pragma: allowlist secret
```

Returns an `access_token` (a Supabase-issued JWT) and `refresh_token`.

### 2. Call a product-domain endpoint

```bash
curl http://localhost:8000/api/v1/organizations \
  -H "Authorization: Bearer <access_token from step 1>"
```

Every dashboard-facing endpoint (organizations, contacts) takes the same Supabase access token — Row Level Security scopes the response to whatever orgs the user belongs to. See [Authentication](authentication.md).

The agent-loop tables (`signals`, `tasks`, `interactions`, `contact_memory`) aren't exposed as user-facing endpoints — they're written and read by the agent runtime via the service-role client. `GET /contacts/{id}/timeline` (once implemented) will surface a read-only merged view of them for the dashboard.

## Customising the agent

The Takeoff Runtime agent loop (see [Architecture](architecture.md)) isn't wired up end-to-end yet — the decision engine, Temporal scheduling, and channel subagents are still being built. The LangGraph agent that exists today (`app/core/langgraph/`) isn't wired to an API endpoint; it's the starting point those channel subagents will fork from. The parts you'll most likely change when you wire it up:

| What | Where |
|---|---|
| Agent personality & instructions | `app/core/prompts/system.md` |
| Available tools | `app/core/langgraph/tools/` |
| LLM models & fallback order | `app/services/llm/registry.py` → `LLMRegistry.LLMS` |

## Running pre-commit hooks

Hooks run automatically on `git commit`. To run manually:

```bash
make pre-commit
```

Hooks include: trailing whitespace, YAML/TOML/JSON validation, secret detection, ruff lint + format.

## Troubleshooting

**Database connection error on startup**
Make sure `SUPABASE_DB_*` vars in your `.env` match your Supabase project's Connection string (Project Settings → Database), and that your network/firewall allows outbound connections to Supabase.

**401 from any Supabase-gated route**
Make sure you're sending the Supabase `access_token` (from step 1 above), and that `SUPABASE_JWKS_URL` in your `.env` points at the JWKS endpoint shown in Project Settings → API — a mismatch causes every token to fail verification.

**`detect-secrets` blocking a commit**
If it's a false positive, add `# pragma: allowlist secret` to the end of the flagged line.

**Langfuse errors**
Set `LANGFUSE_TRACING_ENABLED=false` in your `.env` to disable tracing entirely during development.
