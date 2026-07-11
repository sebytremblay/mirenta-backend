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
| `API_PREFIX` | `/api/v1` | Mount path for all API routes (e.g. `/api/v1/organizations`) |
| `ALLOWED_ORIGINS` | `*` | Comma-separated CORS origins |
| `DEFAULT_PERSONA_NAME` | `Alex` | Default agent persona name injected into prompts |

---

## LLM

| Variable | Default | Required | Description |
| --- | --- | --- | --- |
| `OPENAI_API_KEY` | — | Yes | OpenAI API key |
| `DEFAULT_LLM_MODEL` | `gpt-5-mini` | No | Starting model for SMS compose — see [LLM Service](llm-service.md) for fallback order |
| `DEFAULT_LLM_TEMPERATURE` | `0.2` | No | Temperature for chat completions |
| `MAX_TOKENS` | `4000` | No | Max tokens per LLM response |
| `MAX_LLM_CALL_RETRIES` | `3` | No | Retries per model before switching to fallback |
| `LLM_TOTAL_TIMEOUT` | `60` | No | Max seconds for the entire fallback loop |

---

## Twilio (SMS + voice)

| Variable | Default | Required | Description |
| --- | --- | --- | --- |
| `TWILIO_ACCOUNT_SID` | — | Yes, for the SMS/voice agent loop | Parent Twilio Account SID (Console → Account Info). Org numbers are bought into per-org subaccounts under this parent. |
| `TWILIO_AUTH_TOKEN` | — | Yes, for the SMS/voice agent loop | Parent Twilio Auth Token — used for API calls and as a fallback for webhook signature checks on legacy numbers |
| `TWILIO_TOKEN_ENCRYPTION_KEY` | derived from auth token | Recommended in production | Fernet key (`python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"`) used to encrypt per-org subaccount Auth Tokens in `organization_twilio_secrets` |
| `APP_BASE_URL` | `http://localhost:8000` | Yes, for the SMS/voice agent loop | Externally-reachable base URL for this API; a newly-purchased Twilio number's SMS webhook is set to `$APP_BASE_URL$API_PREFIX/webhooks/twilio/sms` (also on the Messaging Service inbound URL) and its voice webhook to `$APP_BASE_URL$API_PREFIX/webhooks/twilio/voice`. Use an ngrok tunnel (or similar) in local dev — Twilio can't reach `localhost` |

If `TWILIO_ACCOUNT_SID` is unset, `POST /api/v1/organizations` skips automatic phone-number provisioning (org creation still succeeds; `phone` stays null unless supplied explicitly). Provisioning creates a Twilio subaccount + Messaging Service + local number per org (ISV architecture type #1). A2P 10DLC Brand/Campaign registration is not automated yet — US outbound SMS may be filtered until each org is registered.

---

## Deepgram (voice STT/TTS)

Required only for inbound voice calls. SMS works without these.

| Variable | Default | Required | Description |
| --- | --- | --- | --- |
| `DEEPGRAM_API_KEY` | — | Yes, for inbound voice | Deepgram API key (console.deepgram.com → API Keys) |
| `DEEPGRAM_STT_MODEL` | `nova-2-conversationalai` | No | Streaming speech-to-text model |
| `DEEPGRAM_TTS_MODEL` | `aura-2-asteria-en` | No | Aura streaming text-to-speech model |
| `DEEPGRAM_ENDPOINTING_MS` | `500` | No | Silence ms before Deepgram finalizes an utterance |
| `DEEPGRAM_UTTERANCE_END_MS` | `1000` | No | Utterance-end detection window |

---

## Voice runtime

| Variable | Default | Description |
| --- | --- | --- |
| `VOICE_LLM_MODEL` | `gpt-5-mini` | Model used for per-turn voice compose (kept separate from SMS so you can pick a lower-latency model) |
| `VOICE_MAX_CALL_SECONDS` | `600` | Soft cap on how long a single inbound call session may run |

---

## Temporal (durable workflows)

| Variable | Default | Description |
| --- | --- | --- |
| `TEMPORAL_ADDRESS` | `localhost:7233` | Temporal server address. Local dev default matches `make temporal-up`'s docker-compose server; Temporal Cloud uses `<namespace>.<account>.tmprl.cloud:7233` |
| `TEMPORAL_NAMESPACE` | `default` | Temporal namespace |
| `TEMPORAL_KEY` | — | API key, only used when `TEMPORAL_TLS=true` (Temporal Cloud) |
| `TEMPORAL_TASK_QUEUE` | `mirenta-runtime` | Task queue the worker polls and the API dispatches workflows to — must match on both sides |
| `TEMPORAL_TLS` | `false` | Set `true` for Temporal Cloud |

The API process signal-with-starts `ContactLoopWorkflow`s but doesn't execute them — run `make worker` as a separate process (or deployment) to actually process the agent loop. Live inbound voice calls run outside Temporal (see [Architecture](architecture.md)); only the hangup finalize step re-enters the loop.

---

## Database (Supabase)

Everything — Supabase Auth's `auth.users`, LangGraph's checkpoint tables (created by the SMS/voice subagents' `AsyncPostgresSaver`), and the hand-managed product-domain tables (see [Database](database.md)) — lives in one Supabase Postgres project. Temporal is the exception: it runs against its own separate Postgres instance, not this one (see `docker-compose.yml`).

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
| `RATE_LIMIT_PROFILES` | `60 per minute` | `GET`/`PATCH /profiles/me` |
| `RATE_LIMIT_ORGANIZATIONS` | `60 per minute` | Organization + membership endpoints |
| `RATE_LIMIT_CONTACTS` | `60 per minute` | Contact + contact-timeline endpoints |
| `RATE_LIMIT_KNOWLEDGE` | `60 per minute` | Organization knowledge-base CRUD |
| `RATE_LIMIT_SIGNALS` | `60 per minute` | Manual signal creation/listing endpoints |
| `RATE_LIMIT_SMS_WEBHOOK` | `120 per minute` | Twilio inbound SMS webhook |
| `RATE_LIMIT_VOICE_WEBHOOK` | `60 per minute` | Twilio inbound voice webhook + Media Stream WebSocket |
| `RATE_LIMIT_AGENT_CHAT` | `30 per minute` | Reserved for the interaction-layer chat endpoint, once wired up |

Rate limiting uses in-memory storage, so limits are tracked per-process (not shared across multiple app instances).

---

## Logging

| Variable | Default (dev) | Default (prod) | Description |
| --- | --- | --- | --- |
| `LOG_LEVEL` | `DEBUG` | `WARNING` | Log level |
| `LOG_FORMAT` | `console` | `json` | `console` for coloured dev output, `json` for structured production logs |
