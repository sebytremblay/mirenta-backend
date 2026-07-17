# app/ — FastAPI application package

Router directory. Pick the child based on what you're touching:

| Directory | Go there for |
|---|---|
| `api/` | Route handlers (`routers/`), the `get_current_user`/`assert_org_member` deps, and Twilio webhook signature helpers |
| `core/` | Settings, logging, rate limiting, ASGI middleware, Langfuse init, and the LangGraph subagents + prompt templates |
| `schemas/` | Pydantic request/response models — one file per Supabase table/view group |
| `services/` | Domain helpers (knowledge grounding, SMS org/contact resolution) and the external-SDK client wrappers (Supabase, Twilio, Temporal, LiveKit) + the LLM registry/service |
| `utils/` | Supabase JWT verification (`auth.py`) and input sanitization (`sanitization.py`) |

`main.py` builds the `FastAPI` app itself (middleware order, CORS, the unversioned `/health`, exception handlers) and mounts `app.api.main.api_router` at `settings.API_PREFIX`. There's no `app/CLAUDE.md`-level logic beyond that — see `app/api/CLAUDE.md` for the router table.
