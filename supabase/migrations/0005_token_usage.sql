-- Per-lead token-usage telemetry (D33 precursor infra).
-- The MVP ships no spend ceiling (D33); this table supplies the baseline metric
-- that decision lacks: cost per lead, broken down by agent stage. The worker
-- writes one row per agent stage per job (one `research` row, one `builder` row),
-- so the per-lead TOTAL is a SUM over the job's rows and the BREAKDOWN reads off
-- the `agent` column. Retries write additional rows, so the totals count real
-- spend honestly rather than deduping it away.
--
-- Tenancy keys on org_id in application code (D30, RLS off for the MVP). Raw
-- token counts persist for granularity, and `cost_usd` persists the cost as it
-- stood at write time, so a later price change never rewrites history.

create table if not exists token_usage (
  id                     uuid primary key default gen_random_uuid(),
  org_id                 uuid not null references organizations(id) on delete cascade,
  job_id                 uuid not null references jobs(id) on delete cascade,
  lead_id                uuid not null references leads(id) on delete cascade,
  -- Which agent stage spent the tokens: 'research' (Managed Agents) or
  -- 'builder' (one-shot Messages API). The breakdown reads off this column.
  agent                  text not null,
  -- The model the stage billed against, captured so a row stays interpretable
  -- after the D35 tiers restore and the pinned model changes.
  model                  text not null,
  -- Raw counts for granularity. bigint because a long research session
  -- accumulates across many model requests.
  input_tokens           bigint not null default 0,
  output_tokens          bigint not null default 0,
  cache_creation_tokens  bigint not null default 0,
  cache_read_tokens      bigint not null default 0,
  -- Model requests these counts sum over: 1 for a builder call, one per research
  -- model_request_end event.
  request_count          int not null default 0,
  -- USD cost computed at write time from the model rate (src/providers/pricing.ts).
  cost_usd               numeric(12, 6) not null default 0,
  created_at             timestamptz not null default now()
);

create index if not exists token_usage_job_idx on token_usage (job_id);
create index if not exists token_usage_org_idx on token_usage (org_id);
create index if not exists token_usage_lead_idx on token_usage (lead_id);
