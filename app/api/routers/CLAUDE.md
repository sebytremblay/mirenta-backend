# app/api/routers/ — route handlers

All routers are mounted under `settings.API_PREFIX` (default `/api`) via `app/api/main.py` — route decorators below are relative to that prefix. Every route carries a `@limiter.limit(settings.RATE_LIMIT_ENDPOINTS["<key>"][0])` decorator; the endpoint keys live in `app/core/config.py`.

| File | Endpoints | Auth |
|---|---|---|
| `auth.py` | No routes — defines `get_current_user` dependency (verifies Supabase JWT via `app.utils.auth.verify_supabase_token`, binds `user_id` to log context) | — |
| `health.py` | `GET /health` — cheap liveness check (no DB round-trip); the unversioned `/health` in `app/main.py` does the real DB check for load balancers | none |
| `profiles.py` | `GET`/`PATCH /profiles/me` — caller's own profile (name, avatar, `onboarding_completed`) | RLS via `get_user_client` |
| `organizations.py` | `GET`/`POST /organizations`, `GET`/`PATCH /organizations/{id}`, `GET`/`POST /organizations/{id}/members` — org CRUD + membership. `POST /organizations` also best-effort provisions a Twilio subaccount/number/Messaging Service (`twilio_client.provision_org_twilio`) when `TWILIO_ACCOUNT_SID` is set; a Twilio failure here is swallowed (logged, not raised) since the org row already committed | RLS via `get_user_client` |
| `contacts.py` | `GET`/`POST /organizations/{org_id}/contacts`, `GET`/`PATCH`/`DELETE .../contacts/{id}`, `GET .../contacts/{id}/timeline` (reads the `contact_timeline` view) | `assert_org_member` + service-role client (RLS-locked table) |
| `knowledge.py` | `GET`/`POST /organizations/{org_id}/knowledge`, `PATCH`/`DELETE .../knowledge/{id}` — org KB CRUD grounding SMS/voice replies | RLS via `get_user_client` (`is_org_member` read, `is_org_admin` write) |
| `signals.py` | `POST /webhooks/twilio/sms` (inbound SMS webhook — the entry point for the whole agent loop), `POST`/`GET /organizations/{org_id}/signals`, `GET .../signals/{id}` | webhook: Twilio signature; dashboard routes: `assert_org_member` + service-role client |
| `voice.py` | `POST /webhooks/twilio/voice` (inbound call → LiveKit SIP dial), `POST /internal/voice/bootstrap`, `POST /internal/voice/finalize` (LiveKit agent ↔ backend bridge) | webhook: Twilio signature; internal routes: `X-Mirenta-Internal-Key` shared secret (`_require_internal_api_key`), not JWT |

## `signals.py` — the SMS entry point

`receive_twilio_sms` is the one router endpoint with real branching logic:
1. Validates the Twilio signature against the resolved org's token (or parent, pre-org-resolution for the lookup itself).
2. Inserts a `signals` row; `dedup_key=MessageSid` is the idempotency boundary — a Postgres unique-violation (`23505`) on replay returns the existing row instead of erroring.
3. Tries `app.services.sms_interaction.handle_sms_keyword_fastpath` (STOP/START) synchronously; if it didn't handle the message, signal-with-starts `ContactLoopWorkflow` via Temporal and marks the signal `"delivered"` (not `"processed"` — that transition happens later, inside the workflow, via `activities/contact_store.py`).
4. Any dispatch exception marks the signal `"failed"` but still returns 200 with the recorded `Signal` — Twilio doesn't get retried into a duplicate-processing loop.

## `voice.py` gotchas

- `receive_twilio_call` resolves DNC/consent **synchronously in the webhook** (`decision.guardrails.check_dnc`/`check_consent`) before dialing into LiveKit — this is the one path in the codebase where compliance gating happens outside the decision engine, because a live call can't wait on Temporal scheduling. See `docs/architecture.md`'s voice-webhook section.
- Falls back to `generate_voice_reject_twiml` (speak + hangup) whenever `settings.LIVEKIT_SIP_URI` is unset, the call is blocked, or the signature/org lookup fails — never leaves a call hanging with no TwiML response.
- `_require_internal_api_key` uses `secrets.compare_digest` against `settings.MIRENTA_INTERNAL_API_KEY` — bootstrap/finalize have no other auth, since the caller is the LiveKit Cloud agent worker, not a dashboard user.
