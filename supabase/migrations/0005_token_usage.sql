create table if not exists token_usage (
  id                     uuid primary key default gen_random_uuid(),
  org_id                 uuid not null references organizations(id) on delete cascade,
  job_id                 uuid not null references jobs(id) on delete cascade,
  lead_id                uuid not null references leads(id) on delete cascade,
  agent                  text not null,
  model                  text not null,
  input_tokens           bigint not null default 0,
  output_tokens          bigint not null default 0,
  cache_creation_tokens  bigint not null default 0,
  cache_read_tokens      bigint not null default 0,
  request_count          int not null default 0,
  cost_usd               numeric(12, 6) not null default 0,
  created_at             timestamptz not null default now()
);

create index if not exists token_usage_job_idx on token_usage (job_id);
create index if not exists token_usage_org_idx on token_usage (org_id);
create index if not exists token_usage_lead_idx on token_usage (lead_id);
