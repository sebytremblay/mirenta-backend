# Authentication

## Flow

User identity is Supabase Auth — clients sign up and log in **directly against Supabase**, not against this backend. This backend only verifies the resulting Supabase JWT.

```mermaid
sequenceDiagram
    participant C as Client
    participant S as Supabase Auth
    participant A as This API

    C->>S: POST /auth/v1/signup or /auth/v1/token (password grant)
    S-->>C: {access_token, refresh_token} (Supabase JWT)

    C->>A: GET/POST /api/v1/organizations, contacts, ...<br/>Bearer: Supabase access_token
    A-->>C: response (RLS-scoped to the caller)
```

The Supabase access token identifies the user (`sub` = `auth.users.id`) and is verified locally via `SUPABASE_JWT_SECRET` (`verify_supabase_token` in `app/utils/auth.py`). The same token is forwarded to Supabase's PostgREST layer for every product-domain request, so Row Level Security — not application code — decides what each request can see or change.

This backend never stores a password or issues a user-identity token itself — that's entirely Supabase's responsibility, and there is no separate backend-issued token type.

---

## Sign up / log in — handled by Supabase, not this API

Call Supabase Auth directly (REST API or a Supabase client SDK):

```bash
curl -X POST "$SUPABASE_URL/auth/v1/signup" \
  -H "apikey: $SUPABASE_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"email": "you@example.com", "password": "Secret123!"}'  # pragma: allowlist secret
```

```bash
curl -X POST "$SUPABASE_URL/auth/v1/token?grant_type=password" \
  -H "apikey: $SUPABASE_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"email": "you@example.com", "password": "Secret123!"}'  # pragma: allowlist secret
```

Both return `access_token`/`refresh_token`. Use `access_token` as the Bearer token for every endpoint below.

---

## Product-domain endpoints

`Organization`/`Knowledge`/`Contact`/`Conversation`/`Appointment` endpoints (see `app/api/v1/organizations.py`, `knowledge.py`, `contacts.py`, `conversations.py`, `appointments.py`) all require a Supabase access token, forwarded to Supabase's PostgREST layer so Row Level Security enforces org-membership authorization — see [Database](database.md#row-level-security) for the policy details.

---

## Security notes

- Passwords are never seen or stored by this backend — Supabase Auth owns credential storage and hashing entirely.
- `SUPABASE_JWT_SECRET` must match the JWT Secret shown in your Supabase project's Project Settings → API — a mismatch causes every token to fail verification.
- All string inputs are sanitised before use.
- Rate limits protect the product-domain endpoints against abuse — see [Configuration](configuration.md#rate-limiting).
