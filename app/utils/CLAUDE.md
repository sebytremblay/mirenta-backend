# app/utils/ — shared utilities

- **`auth.py`** — `verify_supabase_token`: validates JWT format via regex before touching `jose`, then verifies against Supabase's JWKS (`settings.SUPABASE_JWKS_URL`). JWKS is cached for `JWKS_CACHE_TTL_SECONDS=3600`; `_get_signing_key` does a double-check locked refresh, and if the token's `kid` still isn't found after a TTL-triggered refresh, it forces one unconditional re-fetch (handles key rotation between cache windows) before giving up and returning `None`. Algorithm is read from the matched JWK (`signing_key.get("alg", "ES256")`), not hardcoded.

- **`sanitization.py`** — only `sanitize_string` is actually called anywhere in the app (`app/api/routers/auth.py`, on the raw bearer token before JWT verification). `sanitize_dict`/`sanitize_list` are defined and recursively call each other but have no call sites in the codebase — dead code today, not wired into any request-body sanitization path despite existing for that purpose.
