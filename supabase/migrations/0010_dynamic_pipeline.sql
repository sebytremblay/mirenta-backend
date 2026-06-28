-- Dynamic per-lead pipeline: drop the vertical registry, persist the two
-- planning artifacts, and teach the claim RPC about the two new statuses.
--
-- The pipeline no longer routes a lead through a hardcoded vertical. The
-- strategist plans a research plan plus a metric recipe per lead, and the
-- designer emits a bespoke page spec per lead. Both artifacts persist on the
-- job so a transient retry of a later stage never regenerates a different plan.

-- The strategist artifact ({plan, recipe}) and the designer artifact (PageSpec),
-- stored as JSONB and validated on read. Both stay null until their stage runs.
alter table jobs
  add column if not exists strategy jsonb,
  add column if not exists page_spec jsonb;

-- The registry is gone, so the product profile no longer carries a vertical id
-- or a per-vertical economics blob. The strategist derives both per lead.
alter table product_profiles
  drop column if exists vertical,
  drop column if exists economics;

-- The worker now advances through planning and designing as well, so the claim
-- RPC must lease jobs parked in those statuses or they never get picked up.
create or replace function claim_jobs(batch_size int, lease_seconds int)
  returns setof jobs
  language sql
  security definer
  set search_path = public
as $$
  update jobs
  set lease_until = now() + make_interval(secs => lease_seconds),
      attempts    = attempts + 1
  where id in (
    select id from jobs
    where status in ('pending', 'planning', 'researching', 'designing', 'building', 'publishing')
      and (lease_until is null or lease_until < now())
    order by created_at
    limit batch_size
    for update skip locked
  )
  returning *;
$$;
