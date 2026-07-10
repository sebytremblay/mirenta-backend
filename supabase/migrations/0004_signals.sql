-- 0004_signals.sql
-- Signals: everything that kicks off (or re-enters) the agent loop.

create type signal_type as enum (
  'webhook',             -- external system event
  'inbound_call',
  'inbound_sms',
  'inbound_email',
  'portal_event',
  'interaction_result',  -- emitted by activities/logging.py to close the loop
  'manual'               -- operator-injected via POST /signals
);

create type signal_status as enum ('received', 'delivered', 'processed', 'ignored', 'failed');

create table signals (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organizations (id) on delete cascade,
  contact_id    uuid references contacts (id) on delete cascade,  -- nullable: may arrive before contact is resolved
  type          signal_type not null,
  channel       channel,
  source        text,                                 -- 'twilio', 'sendgrid', 'portal', 'system'
  dedup_key     text unique,                          -- provider message id etc.; rejects webhook replays
  payload       jsonb not null default '{}'::jsonb,   -- normalized Signal model dump
  raw_payload   jsonb,                                -- original provider body, for audit/debug
  status        signal_status not null default 'received',
  error         text,
  received_at   timestamptz not null default now(),
  delivered_at  timestamptz,                          -- when handed to the Temporal workflow
  processed_at  timestamptz                           -- when the decision engine consumed it
);

create index signals_org_id_idx           on signals (org_id);
create index signals_contact_received_idx on signals (contact_id, received_at desc);
create index signals_status_idx           on signals (status) where status in ('received', 'failed');
create index signals_type_idx             on signals (type);
create index signals_payload_gin          on signals using gin (payload jsonb_path_ops);

alter table signals enable row level security;
