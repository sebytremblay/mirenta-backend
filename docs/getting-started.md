# Getting Started

## Prerequisites

- Python 3.13+
- [uv](https://docs.astral.sh/uv/) — `pip install uv`
- A [Supabase](https://supabase.com) project (free tier is fine) — provides Postgres and Auth
- OpenAI API key
- Langfuse account (optional — set `LANGFUSE_TRACING_ENABLED=false` to skip)
- Docker (optional — only needed to run a local Temporal server via `make temporal-up`, required for the SMS agent loop end-to-end)
- A Twilio account with a phone number, or let the API buy one for you when you create an org (optional — only needed for SMS/voice; the CRUD API works without it)
- A Deepgram API key (optional — only needed for inbound voice calls)

## Set up your Supabase project

1. Create a project at [supabase.com](https://supabase.com).
2. From **Project Settings → API**, copy the Project URL, publishable key, secret key, and JWKS URL.
3. From **Project Settings → Database → Connection string**, copy the direct connection host/port/user/password.
4. Run the migrations in `supabase/migrations/` in order (`0001` through `0010`) via the Supabase SQL editor or CLI — see `docs/database.md` for what each one adds.

## Run locally

```bash
git clone <repo-url> my-agent
cd my-agent

cp .env.example .env.development
# Required: OPENAI_API_KEY, SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY,
#           SUPABASE_SECRET_KEY, SUPABASE_JWKS_URL, SUPABASE_DB_*
# Optional: LANGFUSE_* keys (or set LANGFUSE_TRACING_ENABLED=false)
# For SMS/voice: TWILIO_*, APP_BASE_URL (ngrok in local dev)
# For inbound voice: DEEPGRAM_API_KEY

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

That lists orgs the caller belongs to (empty until they've created or been invited to one). Profile state for onboarding lives at `GET`/`PATCH /api/v1/profiles/me`:

```bash
curl http://localhost:8000/api/v1/profiles/me \
  -H "Authorization: Bearer <access_token>"

curl -X PATCH http://localhost:8000/api/v1/profiles/me \
  -H "Authorization: Bearer <access_token>" \
  -H "Content-Type: application/json" \
  -d '{"full_name": "Alex", "onboarding_completed": true}'
```

After you have an `org_id` (from the list or from `POST /api/v1/organizations`), call org-scoped routes such as contacts and knowledge.

Every dashboard-facing endpoint (organizations, contacts, knowledge, profiles) takes the same Supabase access token — Row Level Security scopes the response to whatever orgs the user belongs to (or their own profile row). See [Authentication](authentication.md).

The agent-loop tables (`signals`, `tasks`, `interactions`, `contact_memory`) aren't exposed as user-facing endpoints — they're written and read by the agent runtime via the service-role client. `GET /api/v1/organizations/{org_id}/contacts/{id}/timeline` surfaces a read-only merged view of them for the dashboard. Org knowledge is managed at `GET/POST/PATCH/DELETE /api/v1/organizations/{org_id}/knowledge`.

## Run the full agent loop (SMS)

The steps above get you the CRUD API. To actually exercise the Mirenta Runtime loop — inbound text in, LLM-drafted reply out — you also need Temporal running and a worker:

```bash
make temporal-up      # local Temporal server + UI (docker-compose), or point TEMPORAL_ADDRESS at Temporal Cloud
make worker            # separate process: registers ContactLoopWorkflow/TaskExecutionWorkflow + activities
```

Fill in `TWILIO_ACCOUNT_SID`/`TWILIO_AUTH_TOKEN` in your `.env` and set `APP_BASE_URL` to a URL Twilio can reach (e.g. an ngrok tunnel in local dev) — that's what a newly-provisioned number's SMS and voice webhooks point at (`$APP_BASE_URL/api/v1/webhooks/twilio/sms` and `.../voice`). Creating an org via `POST /api/v1/organizations` without a `phone` will then create a Twilio subaccount, Messaging Service, and buy it a local number automatically; texting that number should get you a real, context-aware, knowledge-grounded LLM reply. Seed or create knowledge entries under `/api/v1/organizations/{org_id}/knowledge` so compose has facts to work from. See [Architecture](architecture.md) for how the pieces fit together, and its [Component status](architecture.md#component-status) table for what's live.

## Run inbound voice

With the API + Temporal worker already running, also set `DEEPGRAM_API_KEY`. Calling the org's Twilio number hits `POST /api/v1/webhooks/twilio/voice`, which answers with Media Streams TwiML and bridges audio through Deepgram STT/TTS to the voice LangGraph subagent. DNC/consent are checked synchronously in the webhook (not via the decision engine). On hangup, the call is logged and re-enters `ContactLoopWorkflow` the same way an SMS interaction does. Voice does not yet ground on the org knowledge base.

## Customising the agent

| What | Where |
|---|---|
| Agent personality & instructions | `app/core/prompts/system.md` |
| Org facts that ground SMS replies | `knowledge` table / `/organizations/{org_id}/knowledge` API |
| Staff profile / onboarding flag | `profiles` table / `GET`/`PATCH /profiles/me` |
| Discover caller's orgs after login | `GET /organizations` |
| Available tools | `app/core/langgraph/tools/` |
| SMS compose/guardrail behavior | `app/core/langgraph/nodes/compose.py`, `nodes/output_guardrails.py` |
| Voice compose/guardrail behavior | `app/core/langgraph/nodes/voice_compose.py`, `nodes/voice_output_guardrails.py` |
| Decision-engine rules (what tasks get emitted for a signal) | `decision/rules.py` |
| Compliance guardrails (DNC, consent, frequency cap; quiet-hours helpers for future outbound) | `decision/guardrails.py` |
| LLM models & fallback order | `app/services/llm/registry.py` → `LLMRegistry.LLMS` |

Adding a new **outbound** channel (e.g. outbound voice as a `call` task) means: a decision-engine rule in `decision/rules.py`, a send-side activity in `activities/channels.py`, wiring the new `task.type` into `workflows/task_execution.py`, and a subagent under `app/core/langgraph/` subclassing `BaseChannelAgent`. Live inbound duplex sessions (like today's voice path) instead belong in `app/services/runtimes/` and only rejoin Temporal at hangup.

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

**Inbound voice answers but never speaks / no transcripts**
Confirm `DEEPGRAM_API_KEY` is set and that `APP_BASE_URL` is an HTTPS URL Twilio can reach for both the voice webhook and the Media Stream WebSocket (`wss://…/api/v1/ws/twilio/voice/{call_sid}`).
