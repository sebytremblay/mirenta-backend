-- 0005_tasks.sql
-- Tasks: scheduled executable events emitted by the decision engine.
-- Temporal timers are the source of truth for execution; this table is the
-- durable record for auditability, dashboards, and idempotency.

create type task_type as enum ('call', 'sms', 'email', 'webhook', 'api_call');

create type task_status as enum (
  'scheduled',
  'running',
  'completed',
  'failed',
  'canceled',           -- superseded by a newer decision
  'skipped_guardrail'   -- blocked at execution time (quiet hours, DNC, consent, caps)
);

create table tasks (
  id                   uuid primary key default gen_random_uuid(),
  org_id               uuid not null references organizations (id) on delete cascade,
  contact_id           uuid not null references contacts (id) on delete cascade,
  caused_by_signal_id  uuid references signals (id) on delete set null,  -- provenance
  type                 task_type not null,
  status               task_status not null default 'scheduled',
  idempotency_key      text not null unique,      -- decision engine derives this deterministically
  scheduled_for        timestamptz not null,
  payload              jsonb not null default '{}'::jsonb,  -- channel-specific params (template, script goal, url...)
  guardrail_result     jsonb,                     -- which checks passed/failed at execution time
  attempts             integer not null default 0,
  max_attempts         integer not null default 3,
  temporal_workflow_id text,                      -- child TaskExecutionWorkflow id
  temporal_run_id      text,
  error                text,
  started_at           timestamptz,
  completed_at         timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index tasks_org_id_idx     on tasks (org_id);
create index tasks_contact_idx    on tasks (contact_id, created_at desc);
create index tasks_due_idx        on tasks (scheduled_for) where status = 'scheduled';
create index tasks_status_idx     on tasks (status);
create index tasks_signal_idx     on tasks (caused_by_signal_id);

create trigger tasks_set_updated_at
  before update on tasks
  for each row execute function set_updated_at();

alter table tasks enable row level security;
