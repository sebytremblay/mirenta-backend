-- Atomic job-claim RPC for the poll-driven worker.
-- Implements the claim query in mirenta-docs/technical/mvp-pipeline-architecture.md:
-- it leases a bounded batch of due jobs so overlapping ticks never process the
-- same job twice. SECURITY DEFINER lets the backend call it over PostgREST.

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
    where status in ('pending', 'researching', 'building', 'publishing')
      and (lease_until is null or lease_until < now())
    order by created_at
    limit batch_size
    for update skip locked
  )
  returning *;
$$;
