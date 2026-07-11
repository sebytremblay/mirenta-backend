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
| `MAX_TOKENS` | `4000` | No | Max tokens per LLM response |
| `MAX_LLM_CALL_RETRIES` | `3` | No | Retries per model before switching to fallback |
| `LLM_TOTAL_TIMEOUT` | `60` | No | Max seconds for the entire fallback loop |

---

## Twilio (SMS)

| Variable | Default | Required | Description |
| --- | --- | --- | --- |
| `TWILIO_ACCOUNT_SID` | — | Yes, for the SMS agent loop | Twilio Account SID (Console → Account Info) |
| `TWILIO_AUTH_TOKEN` | — | Yes, for the SMS agent loop | Twilio Auth Token — also used to verify inbound webhook signatures |
| `APP_BASE_URL` | `http://localhost:8000` | Yes, for the SMS agent loop | Externally-reachable base URL for this API; a newly-purchased Twilio number's SMS webhook is set to `$APP_BASE_URL/webhooks/twilio/sms`. Use an ngrok tunnel (or similar) in local dev — Twilio can't reach `localhost` |

If `TWILIO_ACCOUNT_SID` is unset, `POST /organizations` skips automatic phone-number provisioning (org creation still succeeds; `phone` stays null unless supplied explicitly).

---

## Temporal (durable workflows)

| Variable | Default | Description |
| --- | --- | --- |
| `TEMPORAL_ADDRESS` | `localhost:7233` | Temporal server address. Local dev default matches `make temporal-up`'s docker-compose server; Temporal Cloud uses `<namespace>.<account>.tmprl.cloud:7233` |
| `TEMPORAL_NAMESPACE` | `default` | Temporal namespace |
| `TEMPORAL_KEY` | — | API key, only used when `TEMPORAL_TLS=true` (Temporal Cloud) |
| `TEMPORAL_TASK_QUEUE` | `mirenta-takeoff` | Task queue the worker polls and the API dispatches workflows to — must match on both sides |
| `TEMPORAL_TLS` | `false` | Set `true` for Temporal Cloud |

The API process signal-with-starts `ContactLoopWorkflow`s but doesn't execute them — run `make worker` as a separate process (or deployment) to actually process the agent loop.

---

## Database (Supabase)

Everything — Supabase Auth's `auth.users`, LangGraph's checkpoint tables (created by the SMS subagent's `AsyncPostgresSaver`), and the hand-managed product-domain tables (see [Database](database.md)) — lives in one Supabase Postgres project. Temporal is the exception: it runs against its own separate Postgres instance, not this one (see `docker-compose.yml`).

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
| `RATE_LIMIT_ROOT` | `10 per minute` | `/` |
| `RATE_LIMIT_HEALTH` | `20 per minute` | `/health` and the versioned health router |
| `RATE_LIMIT_ORGANIZATIONS` | `60 per minute` | Organization + membership endpoints |
| `RATE_LIMIT_CONTACTS` | `60 per minute` | Contact + contact-timeline endpoints |
| `RATE_LIMIT_SIGNALS` | `60 per minute` | Manual signal creation/listing endpoints |
| `RATE_LIMIT_SMS_WEBHOOK` | `120 per minute` | Twilio inbound SMS webhook |
| `RATE_LIMIT_AGENT_CHAT` | `30 per minute` | Reserved for the interaction-layer chat endpoint, once wired up |

Rate limiting uses in-memory storage, so limits are tracked per-process (not shared across multiple app instances).

---

## Logging

| Variable | Default (dev) | Default (prod) | Description |
| --- | --- | --- | --- |
| `LOG_LEVEL` | `DEBUG` | `WARNING` | Log level |
| `LOG_FORMAT` | `console` | `json` | `console` for coloured dev output, `json` for structured production logs |
