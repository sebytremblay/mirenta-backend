# supabase/migrations/

Hand-written SQL, no ORM, applied in filename order. `0001` through `0009` exist today.

## Rules for adding a migration

- **Always add a new file, never edit a shipped one.** Numbering must stay sequential and gapless (`0010_...sql` next). A shipped migration is a historical record of what ran against real environments — editing it after the fact desyncs anyone who already applied it.
- One migration = one coherent change (a table + its indexes/RLS/triggers, or a focused alter). Look at `0009_organization_twilio.sql` (an `alter table` + a new secrets table) for the shape of a small, focused migration.
- Every table needs `alter table <name> enable row level security;` — there is no table in this schema without RLS enabled, even when it has zero policies (see below).
- If the table has an `updated_at` column, add a `before update` trigger calling the shared `set_updated_at()` helper (defined once in `0001_organizations.sql`, reused by every later migration — don't redefine it).
- New `security definer` helper functions (like `is_org_member`/`is_org_admin` in `0001`) need an explicit `revoke ... from public, anon` + `grant execute ... to authenticated, service_role`, or RLS policies that call them fail closed with a permission error, not a denial.
- New views over service-role-only tables need `with (security_invoker = true)` plus `revoke all from anon, authenticated, public; grant select ... to service_role` — see `current_consent` (`0003`) and `contact_timeline` (`0006`) for the pattern.

## RLS policy shape vs. service-role-only

Two access models coexist; know which one a new table needs before writing it:

- **Dashboard-facing tables** (`organizations`, `organization_members`, `profiles`, `knowledge`) have real `select`/`insert`/`update`/`delete` policies, usually gated by the `is_org_member(org_id)` / `is_org_admin(org_id)` helper functions from `0001_organizations.sql`.
- **Agent-loop tables** (`contacts`, `contact_state`, `consent`, `signals`, `tasks`, `interactions`, `contact_memory`, `organization_twilio_secrets`) have RLS **enabled with no policies at all** — that's deliberate, not an oversight. It locks the table to the Supabase service-role key (bypasses RLS) and denies `anon`/`authenticated` entirely. If a new agent-loop table needs dashboard read access later, add an explicit `is_org_member(org_id)`-scoped `select` policy rather than relaxing RLS wholesale.

## Naming conventions observed in this directory

- Indexes: `<table>_<column(s)>_idx`, or `<table>_<column>_unique_idx` for partial-unique indexes (e.g. `organizations_phone_unique_idx`).
- Enums: bare lowercase snake_case, no table prefix (`channel`, `contact_status`, `task_type`) — shared across tables where relevant.
- Partial indexes are used where a query only ever filters one branch (`knowledge_org_id_idx where is_active`, `tasks_due_idx where status = 'scheduled'`, `signals_status_idx where status in ('received', 'failed')`) — prefer this over a full index if a new query has a similar hot/cold split.

Full ERD, per-table notes, and the complete RLS policy table: `docs/database.md`.
