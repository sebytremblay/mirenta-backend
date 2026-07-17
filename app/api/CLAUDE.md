# app/api/ — FastAPI wiring

- `main.py` — assembles `api_router` and includes every router from `routers/` (health, profiles, organizations, contacts, knowledge, signals, voice). This is where a new router file gets registered.
- `deps.py` — `assert_org_member(user, org_id)`: the shared authorization check for endpoints touching the agent-loop tables (`contacts`, `signals`, `tasks`, `interactions`, `contact_memory`, `contact_state`, `consent`) that have RLS enabled with **no policies** (locked to service role). It does a `select` against `organizations` through the caller's forwarded JWT — that table *does* carry `is_org_member` RLS — and 404s (not 403) on failure so org existence isn't leaked. Routers that rely purely on RLS (organizations, profiles, knowledge) don't call this.
- `twilio_utils.py` — shared by `routers/signals.py` and `routers/voice.py`:
  - `public_request_url()` reconstructs the externally-visible URL from `X-Forwarded-Proto`/`X-Forwarded-Host` (needed because Twilio signs against the public URL, not the proxy-to-app hop).
  - `resolve_twilio_auth_token()` / `validate_twilio_signature()` pick the org's decrypted subaccount Auth Token (`organization_twilio_secrets`) when available, falling back to the parent `TWILIO_AUTH_TOKEN` for legacy numbers — every inbound webhook must validate through this before trusting the payload.
  - `mark_signal_status()` updates a `signals` row's `status`/`processed_at`.

See `app/api/routers/CLAUDE.md` for what each router file actually does.
