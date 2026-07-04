# Configuration

All configuration is read from environment variables. Use `.env.development`, `.env.staging`, or `.env.production` — the app loads the right file based on the `APP_ENV` variable.

Copy `.env.example` to get started:

```bash
cp .env.example .env.development
```

---

## Application

| Variable | Default | Description |
| --- | --- | --- |
| `APP_ENV` | `development` | Environment: `development`, `staging`, `production`, `test` |
| `PROJECT_NAME` | `FastAPI LangGraph Template` | Displayed in API docs and logs |
| `VERSION` | `1.0.0` | API version |
| `DEBUG` | `false` | Enables debug logging |
| `API_V1_STR` | `/api/v1` | API prefix |
| `ALLOWED_ORIGINS` | `*` | Comma-separated CORS origins |

---

## LLM

| Variable | Default | Required | Description |
| --- | --- | --- | --- |
| `OPENAI_API_KEY` | — | Yes | OpenAI API key |
| `DEFAULT_LLM_MODEL` | `gpt-5-mini` | No | Starting model — see [LLM Service](llm-service.md) for fallback order |
| `DEFAULT_LLM_TEMPERATURE` | `0.2` | No | Temperature for chat completions |
| `MAX_TOKENS` | `2000` | No | Max tokens per LLM response |
| `MAX_LLM_CALL_RETRIES` | `3` | No | Retries per model before switching to fallback |
| `LLM_TOTAL_TIMEOUT` | `60` | No | Max seconds for the entire fallback loop |

---

## Database (Supabase)

Everything — Supabase Auth's `auth.users`, LangGraph's checkpoint tables (once wired to an endpoint), and the hand-managed product-domain tables (see [Database](database.md)) — lives in one Supabase Postgres project.

| Variable | Default | Description |
| --- | --- | --- |
| `SUPABASE_URL` | — | Your Supabase project URL (Project Settings → API) |
| `SUPABASE_PUBLISHABLE_KEY` | — | Publishable key — used for RLS-scoped requests forwarding the caller's JWT |
| `SUPABASE_SECRET_KEY` | — | Secret key — bypasses RLS, used only for agent-runtime writes |
| `SUPABASE_JWKS_URL` | — | Verifies incoming Supabase-issued user JWTs locally against the project's public signing keys (Project Settings → API → JWT Keys) |
| `SUPABASE_DB_HOST` | `localhost` | Direct Postgres connection host (Project Settings → Database) |
| `SUPABASE_DB_PORT` | `5432` | Direct Postgres connection port |
| `SUPABASE_DB_NAME` | `postgres` | Database name |
| `SUPABASE_DB_USER` | `postgres` | Database user |
| `SUPABASE_DB_PASSWORD` | `postgres` | Database password |
| `POSTGRES_POOL_SIZE` | `20` | Max size of the LangGraph checkpointer's connection pool |

---

## Observability (Langfuse)

| Variable | Default | Description |
| --- | --- | --- |
| `LANGFUSE_TRACING_ENABLED` | `true` | Set to `false` to disable tracing entirely |
| `LANGFUSE_PUBLIC_KEY` | — | Langfuse project public key |
| `LANGFUSE_SECRET_KEY` | — | Langfuse project secret key |
| `LANGFUSE_BASE_URL` | `https://cloud.langfuse.com` | Langfuse host (self-hosted or cloud) |

---

## Rate limiting

| Variable | Default | Description |
| --- | --- | --- |
| `RATE_LIMIT_DEFAULT` | `200 per day, 50 per hour` | Fallback limit |
| `RATE_LIMIT_ORGANIZATIONS` | `60 per minute` | Organization + membership endpoints |
| `RATE_LIMIT_KNOWLEDGE` | `60 per minute` | Knowledge endpoints |
| `RATE_LIMIT_CONTACTS` | `60 per minute` | Contact endpoints |
| `RATE_LIMIT_CONVERSATIONS` | `60 per minute` | Conversation + timeline endpoints |
| `RATE_LIMIT_APPOINTMENTS` | `60 per minute` | Appointment endpoints |

Rate limiting uses in-memory storage, so limits are tracked per-process (not shared across multiple app instances).

---

## Logging

| Variable | Default (dev) | Default (prod) | Description |
| --- | --- | --- | --- |
| `LOG_LEVEL` | `DEBUG` | `WARNING` | Log level |
| `LOG_FORMAT` | `console` | `json` | `console` for coloured dev output, `json` for structured production logs |
