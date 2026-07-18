-- 0010_google_calendar.sql
-- Google Calendar integration for the voice agent's schedule_meeting tool.
--
-- organization_google_credentials: per-org OAuth refresh token (encrypted at
-- rest), service-role only — same model as organization_twilio_secrets.
--
-- Note: there is deliberately no structured "properties/listings" table. What
-- the agent reads out (addresses, listing details, meeting locations) lives in
-- the existing per-org knowledge base (0008_knowledge.sql), which is already
-- injected into the agent's context via the voice bootstrap. Keeping listing
-- data as free-form knowledge avoids overfitting the platform to realtors.

-- ---------------------------------------------------------------------------
-- organization_google_credentials: OAuth refresh token (encrypted at rest).
-- Keyed per-org (one connected Google Calendar per organization). The refresh
-- token mints access tokens silently, so the realtor never re-authenticates.
-- RLS enabled with no policies — service_role only (same model as
-- organization_twilio_secrets / signals / tasks): the token is read only by the
-- agent runtime, never by a dashboard user.
-- ---------------------------------------------------------------------------
create table organization_google_credentials (
  org_id                  uuid primary key references organizations (id) on delete cascade,
  refresh_token_encrypted text not null,
  google_email            text,
  scope                   text,
  calendar_id             text not null default 'primary',
  token_expires_at        timestamptz,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

create trigger organization_google_credentials_set_updated_at
  before update on organization_google_credentials
  for each row execute function set_updated_at();

alter table organization_google_credentials enable row level security;
