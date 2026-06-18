-- Mirenta backend MVP schema.
-- Implements mirenta-docs/technical/mvp-data-model.md. Tenancy keys on org_id.
-- RLS stays off for the MVP (D30): the worker reaches the database through a
-- service credential and isolation runs in application code. Logged in BACKLOG.

create extension if not exists "uuid-ossp" with schema extensions;

-- Organizations and membership -------------------------------------------------

create table if not exists organizations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  slug        text unique not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists memberships (
  org_id      uuid not null references organizations(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  role        text not null default 'member',  -- owner | admin | member
  created_at  timestamptz not null default now(),
  primary key (org_id, user_id)
);

create index if not exists memberships_user_idx on memberships (user_id);

-- Product profile (one per org) -------------------------------------------------

create table if not exists product_profiles (
  org_id          uuid primary key references organizations(id) on delete cascade,
  -- Required: the precondition gate rejects a lead when any of these is null.
  company_name    text not null,
  product_name    text not null,
  value_prop      text not null,
  -- Optional but recommended for page quality.
  positioning     text,
  proof_points    jsonb,                 -- array of {claim, source}
  cta_text        text,
  brand           jsonb,                 -- {primary_color, logo_url, ...}
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- Leads and batches -------------------------------------------------------------

create table if not exists lead_batches (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete cascade,
  source      text,                      -- 'csv' | 'api' | 'manual'
  created_at  timestamptz not null default now()
);

create table if not exists leads (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organizations(id) on delete cascade,
  batch_id      uuid references lead_batches(id) on delete set null,
  first_name    text not null,
  last_name     text not null,
  role          text,
  company       text not null,
  website_url   text,
  email         text,
  custom_fields jsonb,
  created_at    timestamptz not null default now()
);

create index if not exists leads_org_idx on leads (org_id);
create index if not exists leads_batch_idx on leads (batch_id);

-- Research objects --------------------------------------------------------------

create table if not exists research (
  id          uuid primary key default gen_random_uuid(),
  job_id      uuid not null,             -- FK added after jobs exists
  org_id      uuid not null references organizations(id) on delete cascade,
  payload     jsonb not null,            -- validated against the research schema
  created_at  timestamptz not null default now()
);

create index if not exists research_job_idx on research (job_id);

-- Jobs (the durable state machine) ----------------------------------------------

create table if not exists jobs (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references organizations(id) on delete cascade,
  lead_id             uuid not null references leads(id) on delete cascade,
  batch_id            uuid references lead_batches(id) on delete set null,
  status              text not null default 'pending',
    -- pending | researching | building | publishing | done | failed
  -- Stage handoffs
  research_id         uuid references research(id),
  html_s3_key         text,
  site_url            text,
  -- Failure and recovery
  failure_reason      text,
  attempts            int not null default 0,
  lease_until         timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists jobs_status_idx on jobs (status, lease_until);
create index if not exists jobs_org_idx on jobs (org_id);
create index if not exists jobs_batch_idx on jobs (batch_id);

-- Now that jobs exists, tie research.job_id to it.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'research_job_id_fkey'
  ) then
    alter table research
      add constraint research_job_id_fkey
      foreign key (job_id) references jobs(id) on delete cascade;
  end if;
end $$;

-- updated_at maintenance --------------------------------------------------------

create or replace function set_updated_at() returns trigger
  language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists organizations_set_updated_at on organizations;
create trigger organizations_set_updated_at before update on organizations
  for each row execute function set_updated_at();

drop trigger if exists product_profiles_set_updated_at on product_profiles;
create trigger product_profiles_set_updated_at before update on product_profiles
  for each row execute function set_updated_at();

drop trigger if exists jobs_set_updated_at on jobs;
create trigger jobs_set_updated_at before update on jobs
  for each row execute function set_updated_at();
