# app/schemas/ — Pydantic request/response models

One file per Supabase table/view group; all response models extend `base.py`'s `BaseResponse` (auto-populates `request_id` from the correlation-ID context var — no endpoint sets it explicitly). Re-exported centrally from `app/schemas/__init__.py` (`from app.schemas import GraphState, Signal, ...`) — most call sites import from there rather than the submodule directly, except `contacts.py`/`interactions.py` types like `Contact`/`Channel`, which get imported from their submodule paths in routers (`from app.schemas.contacts import Contact, ContactStatus`).

| File | Table(s)/view | Paired router/service |
|---|---|---|
| `auth.py` | — (`SupabaseUser`, not a table) | `app/api/routers/auth.py` (`get_current_user`) |
| `contacts.py` | `contacts`, `contact_state`, `consent`, `current_consent` view | `app/api/routers/contacts.py`, `app/services/sms_interaction.py`, `decision/guardrails.py` (DNC/consent checks) |
| `graph.py` | — (`GraphState`, LangGraph state base) | `app/core/langgraph/state.py` (`SMSState`/`VoiceState` extend it) |
| `interactions.py` | `interactions`, `contact_timeline` view | `app/api/routers/contacts.py` (timeline endpoint), `activities/logging.py` |
| `knowledge.py` | `knowledge` | `app/api/routers/knowledge.py`, `app/services/knowledge.py` |
| `memory.py` | `contact_memory`, `match_contact_memory` RPC | not yet wired to any router/activity in this repo — schemas exist ahead of the semantic-recall feature |
| `organizations.py` | `organizations`, `organization_members` | `app/api/routers/organizations.py` |
| `profiles.py` | `profiles` | `app/api/routers/profiles.py` |
| `signals.py` | `signals` | `app/api/routers/signals.py`, `app/api/routers/voice.py`, `activities/contact_store.py` |
| `tasks.py` | `tasks` | `decision/engine.py`, `workflows/task_execution.py` |
| `voice.py` | — (LiveKit bridge request/response, not a table) | `app/api/routers/voice.py` (`bootstrap_voice_session`/`finalize_voice_session`) — plain `BaseModel`, not `BaseResponse` (no `request_id`, since these are called by the LiveKit agent worker, not the dashboard) |

Notable cross-file coupling: `interactions.py`'s `Channel` type comes from `contacts.py` (`from app.schemas.contacts import Channel`) rather than being redefined — if you add a channel, update `contacts.py`'s `Channel` literal, not a local copy.
