-- 0003_contacts.sql
-- Shared enums, contacts, per-contact state, and consent. All org-scoped
-- via org_id (organizations defined in 0001_organizations.sql).

create extension if not exists citext;     -- case-insensitive email

-- ---------------------------------------------------------------------------
-- Shared enums
-- ---------------------------------------------------------------------------
create type channel as enum ('sms', 'email', 'voice', 'webhook', 'portal');

create type contact_status as enum ('active', 'paused', 'archived', 'dnc');

-- ---------------------------------------------------------------------------
-- contacts: identity + reachability
-- ---------------------------------------------------------------------------
create table contacts (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references organizations (id) on delete cascade,
  external_id  text,                           -- id in your CRM / source system
  first_name   text,
  last_name    text,
  phone        text,                            -- E.164, e.g. +14155550123
  email        citext,
  timezone     text not null default 'America/Los_Angeles',  -- IANA tz, drives quiet hours
  status       contact_status not null default 'active',
  attributes   jsonb not null default '{}'::jsonb,  -- arbitrary CRM fields
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (org_id, external_id),
  unique (org_id, phone)
);

create index contacts_org_id_idx    on contacts (org_id);
create index contacts_email_idx     on contacts (org_id, email);
create index contacts_status_idx    on contacts (org_id, status);

create trigger contacts_set_updated_at
  before update on contacts
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- contact_state: 1:1 mutable workflow state (what the decision engine reads)
-- ---------------------------------------------------------------------------
create table contact_state (
  contact_id            uuid primary key references contacts (id) on delete cascade,
  org_id                uuid not null references organizations (id) on delete cascade,
  current_state         text not null default 'new',   -- decision-engine state machine node
  goal                  text,                          -- current objective, e.g. 'book_appointment'
  temporal_workflow_id  text,                          -- contact-{id}; running ContactLoopWorkflow
  last_contacted_at     timestamptz,
  contact_attempts      integer not null default 0,    -- rolling attempt counter for frequency caps
  attempts_window_start timestamptz,                   -- start of the current frequency-cap window
  next_task_at          timestamptz,                   -- convenience mirror of earliest scheduled task
  memory_summary        text,                          -- rolling summary injected into agent context
  data                  jsonb not null default '{}'::jsonb,  -- free-form state for rules
  updated_at            timestamptz not null default now()
);

create index contact_state_org_id_idx on contact_state (org_id);

create trigger contact_state_set_updated_at
  before update on contact_state
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- consent: per-channel, auditable (never update in place — revoke + re-grant)
-- ---------------------------------------------------------------------------
create table consent (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations (id) on delete cascade,
  contact_id  uuid not null references contacts (id) on delete cascade,
  channel     channel not null,
  granted     boolean not null,
  source      text not null,                  -- 'web_form', 'sms_reply', 'agent_call', 'import'
  note        text,
  occurred_at timestamptz not null default now(),
  created_at  timestamptz not null default now()
);

create index consent_org_id_idx on consent (org_id);
create index consent_contact_channel_idx
  on consent (contact_id, channel, occurred_at desc);

-- Latest consent decision per contact/channel (what guardrails.py queries)
create view current_consent as
select distinct on (contact_id, channel)
  contact_id,
  channel,
  granted,
  source,
  occurred_at
from consent
order by contact_id, channel, occurred_at desc;

-- ---------------------------------------------------------------------------
-- RLS: lock tables to the service role (backend uses the service key,
-- which bypasses RLS; enabling RLS with no policies blocks anon/authed keys)
-- ---------------------------------------------------------------------------
alter table contacts      enable row level security;
alter table contact_state enable row level security;
alter table consent       enable row level security;
