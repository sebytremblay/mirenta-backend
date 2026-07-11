-- 0012_organization_twilio.sql
-- Per-org Twilio ISV isolation: public SIDs on organizations, encrypted
-- subaccount auth token in a service-role-only secrets table.
-- See docs/architecture.md (org phone auto-provisioning) and
-- https://www.twilio.com/docs/messaging/compliance/a2p-10dlc/onboarding-isv

-- ---------------------------------------------------------------------------
-- Public Twilio resource SIDs on organizations (safe for member SELECT)
-- ---------------------------------------------------------------------------
alter table organizations
  add column twilio_subaccount_sid text,
  add column twilio_phone_sid text,
  add column twilio_messaging_service_sid text;

create unique index organizations_phone_unique_idx
  on organizations (phone)
  where phone is not null;

create unique index organizations_twilio_subaccount_sid_unique_idx
  on organizations (twilio_subaccount_sid)
  where twilio_subaccount_sid is not null;

-- ---------------------------------------------------------------------------
-- organization_twilio_secrets: subaccount Auth Token (encrypted at rest).
-- Needed to validate X-Twilio-Signature for webhooks owned by the subaccount.
-- RLS enabled with no policies — service_role only (same model as signals/tasks).
-- ---------------------------------------------------------------------------
create table organization_twilio_secrets (
  org_id               uuid primary key references organizations (id) on delete cascade,
  auth_token_encrypted text not null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create trigger organization_twilio_secrets_set_updated_at
  before update on organization_twilio_secrets
  for each row execute function set_updated_at();

alter table organization_twilio_secrets enable row level security;
