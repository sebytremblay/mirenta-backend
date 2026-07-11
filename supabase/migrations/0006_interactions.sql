-- 0006_interactions.sql
-- Interactions: subagent conversations across voice/SMS/email.
-- Every completed interaction is logged here, then re-emitted as an
-- 'interaction_result' signal (result_signal_id) — closing the loop.

create type interaction_direction as enum ('outbound', 'inbound');

create type interaction_outcome as enum (
  'goal_achieved',      -- e.g. appointment booked
  'progressed',         -- useful exchange, goal not yet met
  'no_answer',
  'voicemail',
  'declined',
  'opt_out',            -- must also write a consent revocation row
  'handoff_human',
  'error'
);

create table interactions (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references organizations (id) on delete cascade,
  contact_id        uuid not null references contacts (id) on delete cascade,
  task_id           uuid references tasks (id) on delete set null,
  channel           channel not null,
  direction         interaction_direction not null,
  agent_graph       text,                                -- 'sms_agent', 'voice_agent', ...
  transcript        jsonb not null default '[]'::jsonb,  -- [{role, content, ts, tool_calls?}, ...]
  summary           text,                                -- summarize node output; feeds memory
  outcome           interaction_outcome,
  outcome_data      jsonb not null default '{}'::jsonb,  -- structured extraction (booked slot, callback time...)
  guardrail_flags   jsonb not null default '[]'::jsonb,  -- output-guardrail hits during the conversation
  provider_ref      text,                                -- Twilio call SID / SendGrid message id
  recording_url     text,                                -- voice only
  input_tokens      integer,
  output_tokens     integer,
  cost_usd          numeric(10, 6),
  result_signal_id  uuid references signals (id) on delete set null,
  started_at        timestamptz not null default now(),
  ended_at          timestamptz,
  created_at        timestamptz not null default now()
);

create index interactions_org_id_idx   on interactions (org_id);
create index interactions_contact_idx  on interactions (contact_id, started_at desc);
create index interactions_task_idx     on interactions (task_id);
create index interactions_outcome_idx  on interactions (outcome);
create index interactions_channel_idx  on interactions (channel);

alter table interactions enable row level security;

-- Contact timeline convenience view (GET /contacts/{id}/timeline).
-- security_invoker so the view respects the caller's RLS on the source
-- tables (service-role only; no policies for anon/authenticated).
create view contact_timeline
with (security_invoker = true) as
select contact_id, 'signal' as kind, id, received_at as occurred_at,
       type::text as label, payload as data
from signals
where contact_id is not null
union all
select contact_id, 'task', id, coalesce(completed_at, scheduled_for),
       type::text || ':' || status::text, payload
from tasks
union all
select contact_id, 'interaction', id, started_at,
       channel::text || ':' || coalesce(outcome::text, 'in_progress'),
       jsonb_build_object('summary', summary, 'outcome_data', outcome_data)
from interactions;

revoke all on contact_timeline from anon, authenticated, public;
grant select on contact_timeline to service_role;
