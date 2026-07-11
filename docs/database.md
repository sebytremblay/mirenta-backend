# Database

Everything lives in **one Supabase Postgres project**, managed as hand-written, numbered SQL migrations in `supabase/migrations/` (no ORM). That covers org/staff identity glue, the contact domain, the per-org knowledge base, and the Mirenta Runtime agent-loop tables (signals, tasks, interactions, memory) — see [Architecture](architecture.md) for how those tables map onto the loop.

User identity (`auth.users`) is owned entirely by Supabase Auth — this repo never creates or migrates a users table. See [Authentication](authentication.md).

The SMS and voice interaction-layer subagents (`app/core/langgraph/sms_graph.py`, `voice_graph.py`) are wired up and checkpoint via `AsyncPostgresSaver`, which creates its own tables (`checkpoints`, `checkpoint_blobs`, `checkpoint_writes`) in this same Postgres project — managed by LangGraph itself, not by this repo. Temporal runs against its own separate Postgres instance (see `docker-compose.yml`) and manages its own workflow-history tables there, not in this Supabase project.

## Migrations

| File | Adds |
|---|---|
| `0001_organizations.sql` | `organizations`, `organization_members`, shared `set_updated_at()` trigger helper |
| `0002_profiles.sql` | `profiles`, auto-provisioning trigger on `auth.users` insert |
| `0003_contacts.sql` | `contacts`, `contact_state`, `consent`, `current_consent` view, shared `channel` enum |
| `0004_signals.sql` | `signals` — everything that kicks off (or re-enters) the agent loop |
| `0005_tasks.sql` | `tasks` — scheduled executable events emitted by the decision engine |
| `0006_interactions.sql` | `interactions`, `contact_timeline` view |
| `0007_memory.sql` | `contact_memory` (pgvector), `match_contact_memory` RPC |
| `0008_seed_demo_org.sql` | Demo `organizations` row for the shared Twilio number |
| `0009_knowledge.sql` | `knowledge` — per-org facts that ground SMS replies (booking, hours, FAQ, …) |
| `0010_secure_agent_views.sql` | `security_invoker` + revoke Data API grants on `current_consent` / `contact_timeline` |

## Schema

```mermaid
erDiagram
    organizations ||--o{ organization_members : "has"
    organizations ||--o{ contacts : "has"
    organizations ||--o{ knowledge : "grounds"
    contacts ||--|| contact_state : "has"
    contacts ||--o{ consent : "has"
    contacts ||--o{ signals : "receives"
    contacts ||--o{ tasks : "targets"
    contacts ||--o{ interactions : "has"
    contacts ||--o{ contact_memory : "has"
    signals ||--o{ tasks : "causes"
    tasks ||--o{ interactions : "triggers"
    interactions ||--o| signals : "re-emits as interaction_result"
    interactions ||--o{ contact_memory : "extracted into"

    organizations {
        uuid id PK
        text name
        text slug UK
        text phone "Twilio number; auto-provisioned on create if omitted"
        text timezone
    }

    knowledge {
        uuid id PK
        uuid org_id FK
        text kind "general|booking|hours|services|faq|policy"
        text title
        text content
        jsonb metadata
        boolean is_active
    }

    organization_members {
        uuid org_id FK
        uuid user_id FK "auth.users"
        text role "owner | admin | member"
    }

    profiles {
        uuid id PK "auth.users.id"
        text full_name
        boolean onboarding_completed
    }

    contacts {
        uuid id PK
        uuid org_id FK
        text external_id "id from source system (CRM, PMS, import, etc.), unique per org"
        text phone UK "E.164, unique per org"
        citext email
        text timezone "IANA timezone for the contact"
        text status "active|paused|archived|dnc"
        jsonb attributes
    }

    contact_state {
        uuid contact_id PK_FK
        text current_state "decision-engine node"
        text goal "org-defined, e.g. book_appointment"
        text temporal_workflow_id "running ContactLoopWorkflow"
        int contact_attempts "frequency-cap counter"
        timestamptz next_task_at
        text memory_summary "rolling summary"
    }

    consent {
        uuid id PK
        uuid contact_id FK
        text channel
        boolean granted
        text source "web_form|sms_reply|agent_call|import"
        timestamptz occurred_at "append-only: revoke = new row"
    }

    signals {
        uuid id PK
        uuid org_id FK
        uuid contact_id FK "nullable until resolved"
        text type "webhook|inbound_sms|interaction_result|manual|..."
        text dedup_key UK "rejects webhook replays"
        jsonb payload
        text status "received|delivered|processed|ignored|failed"
    }

    tasks {
        uuid id PK
        uuid org_id FK
        uuid contact_id FK
        uuid caused_by_signal_id FK
        text type "call|sms|webhook|api_call"
        text status "scheduled|running|completed|failed|canceled|skipped_guardrail"
        text idempotency_key UK
        timestamptz scheduled_for
        text temporal_workflow_id
    }

    interactions {
        uuid id PK
        uuid org_id FK
        uuid contact_id FK
        uuid task_id FK
        text channel
        text direction "outbound|inbound"
        jsonb transcript
        text outcome "goal_achieved|progressed|opt_out|..."
        uuid result_signal_id FK "closes the loop"
        numeric cost_usd
    }

    contact_memory {
        uuid id PK
        uuid contact_id FK
        uuid interaction_id FK
        text kind "summary|fact|transcript_chunk|preference"
        text content
        vector embedding "1536 dims, HNSW cosine"
        uuid superseded_by FK "soft-invalidation"
    }
```

## Tables

**`profiles`** — one row per org-staff user, 1:1 with `auth.users`, auto-created by the `handle_new_user` trigger on sign-up (copies `full_name` / `avatar_url` from OAuth metadata). Dashboard access is via `GET`/`PATCH /api/v1/profiles/me` (own-row RLS); use this for display name and `onboarding_completed`, not auth `user_metadata`.

**`organizations`** — any organization running outreach through Mirenta (a clinic, a dealership, a sales team, an agency, etc.). `slug` is unique and used for routing/branding. `phone` is the Twilio number both SMS and voice webhooks route against; auto-provisioned on create when Twilio credentials are set. `GET /api/v1/organizations` lists orgs the caller belongs to (RLS via `is_org_member`) so returning users can discover `org_id` without storing it in the JWT.

**`organization_members`** — join table between `auth.users` and `organizations`, carrying `role` (`owner` / `admin` / `member`). Enforced today: exactly one `owner` per org at creation time (see RLS below).

**`knowledge`** — per-org facts that ground SMS compose prompts (`kind`: `general` / `booking` / `hours` / `services` / `faq` / `policy`). Dashboard members can read; admins create/update/delete (RLS). The SMS interaction activity loads active rows via the service-role client (`app/services/knowledge.py`), caps at 40 entries, and injects a formatted block into the compose system prompt. Voice does not ground on this table yet. Soft-disable with `is_active = false` rather than deleting if you want to keep history.

**`contacts`** — identity + reachability for someone on an org's outreach list, sourced from an external import (CRM export, spreadsheet, PMS, etc.). `(org_id, external_id)` and `(org_id, phone)` are each unique. `status = 'dnc'` is a hard stop the decision engine checks before emitting any task.

**`contact_state`** — 1:1 mutable workflow state per contact; this is what the decision engine reads on every signal. `current_state` is the decision-engine's state-machine node, `contact_attempts`/`attempts_window_start` back the frequency-cap guardrail, and `temporal_workflow_id` points at the contact's long-running `ContactLoopWorkflow`. `memory_summary` is a cheap denormalized mirror of the latest rolled-up `contact_memory` summary, so building agent context doesn't always require a vector query.

**`consent`** — per-channel consent decisions, **append-only**: a revocation is a new row with `granted = false`, never an update to the prior row. This keeps the compliance trail auditable. `current_consent` is a view returning only the latest decision per `(contact_id, channel)` — what guardrail checks actually query.

**`signals`** — everything that kicks off or re-enters the agent loop: inbound webhooks (`webhook`, `inbound_call`, `inbound_sms`), portal events, operator-injected signals (`manual`), and completed interactions re-entering as `interaction_result`. `dedup_key` is unique and rejects provider webhook replays at the edge. `contact_id` is nullable because a signal (e.g. an inbound SMS from an unrecognized number) may arrive before the contact is resolved. `inbound_call` is now a live producer (the Twilio voice webhook), but unlike `inbound_sms` it's recorded for audit/timeline only — `decision.engine` has no handler for it, since an inbound call is answered synchronously in the webhook rather than routed through the decision engine.

**`tasks`** — scheduled executable events emitted by the deterministic decision engine. `idempotency_key` is unique and derived deterministically by the decision engine, so a retried decision can never double-emit the same task. `caused_by_signal_id` gives provenance back to the triggering signal. `temporal_workflow_id`/`temporal_run_id` link the row to its Temporal `TaskExecutionWorkflow`, which is the actual executor — but only for `type = 'sms'` today; other task types fail immediately, there's no send-side implementation for them yet. Live inbound voice calls don't go through this table at all — see `interactions` below. `status = 'skipped_guardrail'` records a task that was blocked at execution time (DNC, consent, frequency cap) rather than emission time — both checks exist so a guardrail change takes effect on already-scheduled tasks too. `status = 'canceled'` is set when a newer inbound SMS supersedes a pending `follow_up_no_response` task (`activities/contact_store.py::cancel_scheduled_follow_ups`); other scheduled-task supersession cases are not implemented yet.

**`interactions`** — a single subagent conversation across voice/SMS. `transcript` is the turn-by-turn log; `summary` and `outcome`/`outcome_data` are what the summarize step of the subagent produces and what feeds back into `contact_memory`. `result_signal_id` points at the `interaction_result` signal re-emitted from this interaction, closing the loop. `outcome = 'opt_out'` must be paired with a new `consent` row (`granted = false`). Voice rows are now live: `task_id` is `NULL` (a live call has no `tasks` row), `provider_ref` is the Twilio Call SID, `channel = 'voice'`. `recording_url` remains unused/`NULL` — Twilio call recording is a separate feature from the Media Streams bridge and isn't implemented.

**`contact_memory`** — embedded chunks (`kind`: `summary` / `fact` / `transcript_chunk` / `preference`) for semantic recall via the `match_contact_memory` RPC. `embedding` is a 1536-dim `vector` (matches `text-embedding-3-small`; adjust the column and index if you change embedding models) indexed with HNSW cosine distance, which — unlike `ivfflat` — needs no training step and works from an empty table. `superseded_by` soft-invalidates a stale fact/summary by pointing at its replacement rather than deleting it.

### Views and RPCs

**`current_consent`** — `distinct on (contact_id, channel)`, latest `consent` row per pair. This is what compliance guardrails check, not the raw `consent` table. Created with `security_invoker = true` and `SELECT` revoked from `anon`/`authenticated` — service-role only (same access model as `consent`).

**`contact_timeline`** — unions `signals`, `tasks`, and `interactions` into one chronological feed per contact (`GET /contacts/{id}/timeline`), so assembling "everything that's happened with this contact" doesn't require querying three tables separately. Same lockdown as `current_consent` (`security_invoker` + no Data API grants); the FastAPI timeline route reads it via the service-role client:

```sql
select * from contact_timeline
where contact_id = $1
order by occurred_at;
```

**`match_contact_memory(p_contact_id, p_query_embedding, p_match_count, p_min_similarity)`** — cosine-similarity search over `contact_memory`, scoped to one contact, excluding superseded rows and rows below `p_min_similarity` (default `0.3`). Call via `supabase.rpc("match_contact_memory", {...})`.

### Auto-provisioning & bookkeeping triggers

- **`handle_new_user`** — `security definer` trigger on `auth.users` insert; creates the matching `profiles` row.
- **`set_updated_at`** — generic trigger applied to every table with an `updated_at` column (`profiles`, `organizations`, `organization_members`, `contacts`, `contact_state`, `tasks`, `knowledge`); stamps `updated_at = now()` on every update.

### Row Level Security

RLS is enabled on every table. Two `security definer` helper functions back most dashboard-facing policies:

- `is_org_member(org)` — is the current user (`auth.uid()`) a member of `org`?
- `is_org_admin(org)` — is the current user an `owner` or `admin` of `org`?

Those helpers need an explicit `EXECUTE` grant for `authenticated` and `service_role` (see `0011_grant_org_helpers_execute.sql`). Without it, RLS policies that call them fail with `permission denied for function is_org_member` before membership is checked. `anon` / `PUBLIC` should not have execute.

Org create (`POST /organizations`) must insert with `return=minimal`, then insert the caller as owner, then `SELECT` the org. A default PostgREST `INSERT ... RETURNING` hits SELECT RLS (`is_org_member`) before membership exists and fails with `new row violates row-level security policy for table "organizations"`.

Policy shape by table:

| Table | Select | Insert / Update / Delete |
|---|---|---|
| `profiles` | own row only | own row only (update) |
| `organizations` | org members | any authenticated user can create; admins update; owners delete |
| `organization_members` | org members | first member self-inserts as `owner`; admins add/remove thereafter |
| `knowledge` | org members | admins only |
| `contacts` | service role only | service role only |
| `contact_state` | service role only | service role only |
| `consent` | service role only | service role only |
| `signals` | service role only | service role only |
| `tasks` | service role only | service role only |
| `interactions` | service role only | service role only |
| `contact_memory` | service role only | service role only |

RLS is enabled with **no policies** on `contacts`, `contact_state`, `consent`, `signals`, `tasks`, `interactions`, and `contact_memory` — that locks them to the Supabase service role (which bypasses RLS entirely) and denies the anon/authenticated keys by default. The org-facing dashboard doesn't talk to these tables directly today; only the agent runtime, via `get_service_role_client()`. `knowledge` is the exception among outreach-adjacent tables: it has member-read / admin-write policies so the dashboard can manage grounding facts through `GET/POST/PATCH/DELETE /organizations/{org_id}/knowledge`. If/when a dashboard needs read access to, say, the contact timeline, add explicit `select` policies scoped by `is_org_member(org_id)` rather than relaxing RLS wholesale.

### Indexes

- `signals (contact_id, received_at desc)`, `signals (status) where status in ('received', 'failed')`, `signals (type)`, GIN on `signals (payload)` — event-bus-style lookups and reprocessing queues.
- `tasks (scheduled_for) where status = 'scheduled'` — the "what's due to run" query Temporal (or a fallback poller) uses.
- `tasks (contact_id, created_at desc)`, `tasks (caused_by_signal_id)` — provenance and per-contact history.
- `interactions (contact_id, started_at desc)`, `interactions (task_id)`, `interactions (outcome)`, `interactions (channel)` — timeline and reporting queries.
- `contact_memory (contact_id, created_at desc)`, `contact_memory (contact_id, kind)`, HNSW on `contact_memory (embedding)` — semantic recall scoped to one contact.
- `knowledge (org_id) where is_active`, `knowledge (org_id, kind) where is_active` — active-KB lookups for SMS compose.
- `contacts (org_id)`, `contacts (org_id, email)`, `contacts (org_id, status)` — dashboard list views and DNC/status filtering.

### API access

This backend exposes the domain via `app/api/routers/organizations.py` (including `GET /organizations` to list the caller's orgs), `profiles.py` (`GET`/`PATCH /profiles/me`), `contacts.py`, `knowledge.py` (org KB CRUD), `auth.py`, `signals.py` (the Twilio SMS webhook plus manual signal creation/listing for operators), and `voice.py` (the Twilio voice webhook plus the live Media Stream WebSocket). Dashboard-facing routes build a Supabase client scoped to the caller's forwarded access token (`get_user_client` in `app/services/clients/supabase_client.py`), so RLS decides what each request can see or change; agent-runtime code (Temporal activities in `activities/contact_store.py` / `interactions.py`, and `app/services/runtimes/voice_runtime.py` for live calls) uses `get_service_role_client()` to read/write the loop tables above (and to load active `knowledge` for SMS grounding). See [Authentication](authentication.md).
