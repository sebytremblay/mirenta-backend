# Getting Started

## Prerequisites

- Python 3.13+
- [uv](https://docs.astral.sh/uv/) — `pip install uv`
- A [Supabase](https://supabase.com) project (free tier is fine) — provides Postgres and Auth
- OpenAI API key
- Langfuse account (optional — set `LANGFUSE_TRACING_ENABLED=false` to skip)

## Set up your Supabase project

1. Create a project at [supabase.com](https://supabase.com).
2. From **Project Settings → API**, copy the Project URL, `anon` key, `service_role` key, and JWT Secret.
3. From **Project Settings → Database → Connection string**, copy the direct connection host/port/user/password.
4. Run the product-domain SQL (organizations, contacts, conversations, etc. — see `docs/database.md`) in the Supabase SQL editor.

## Run locally

```bash
git clone <repo-url> my-agent
cd my-agent

cp .env.example .env.development
# Required: OPENAI_API_KEY, SUPABASE_URL, SUPABASE_ANON_KEY,
#           SUPABASE_SERVICE_ROLE_KEY, SUPABASE_JWT_SECRET, SUPABASE_DB_*
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
  -H "apikey: $SUPABASE_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"email": "you@example.com", "password": "Secret123!"}'  # pragma: allowlist secret
```

Returns an `access_token` (a Supabase-issued JWT) and `refresh_token`.

### 2. Call a product-domain endpoint

```bash
curl http://localhost:8000/api/v1/organizations \
  -H "Authorization: Bearer <access_token from step 1>"
```

Every product endpoint (organizations, knowledge, contacts, conversations, appointments) takes the same Supabase access token — Row Level Security scopes the response to whatever orgs the user belongs to. See [Authentication](authentication.md).

## Customising the agent

The LangGraph agent (`app/core/langgraph/`) isn't wired to an API endpoint yet — it's kept as infra for generating outreach messages later. The parts you'll most likely change when you wire it up:

| What | Where |
|---|---|
| Agent personality & instructions | `app/core/prompts/system.md` |
| Available tools | `app/core/langgraph/tools.py` |
| LLM models & fallback order | `app/services/llm.py` → `LLMRegistry.LLMS` |

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
Make sure you're sending the Supabase `access_token` (from step 1 above), and that `SUPABASE_JWT_SECRET` in your `.env` matches the JWT Secret shown in Project Settings → API — a mismatch causes every token to fail verification.

**`detect-secrets` blocking a commit**
If it's a false positive, add `# pragma: allowlist secret` to the end of the flagged line.

**Langfuse errors**
Set `LANGFUSE_TRACING_ENABLED=false` in your `.env` to disable tracing entirely during development.
