-- 0001_organizations.sql
-- Organizations (clinics) and membership. Also defines the shared
-- extension + updated_at trigger helper reused by every later migration.

create extension if not exists pgcrypto;   -- gen_random_uuid()

-- ---------------------------------------------------------------------------
-- updated_at trigger helper (reused by every table with an updated_at column)
-- ---------------------------------------------------------------------------
create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- organizations: a clinic (or clinic group)
-- ---------------------------------------------------------------------------
create table organizations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  slug        text not null unique,
  website_url text,
  phone       text,
  timezone    text not null default 'America/Los_Angeles',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create trigger organizations_set_updated_at
  before update on organizations
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- organization_members: join table between auth.users and organizations
-- ---------------------------------------------------------------------------
create type org_member_role as enum ('owner', 'admin', 'member');

create table organization_members (
  org_id     uuid not null references organizations (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  role       org_member_role not null default 'member',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (org_id, user_id)
);

create trigger organization_members_set_updated_at
  before update on organization_members
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- Membership helpers (security definer: bypass RLS on organization_members
-- itself, otherwise the policies below would recurse into themselves)
-- ---------------------------------------------------------------------------
create or replace function is_org_member(org uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from organization_members
    where org_id = org and user_id = auth.uid()
  );
$$;

create or replace function is_org_admin(org uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from organization_members
    where org_id = org and user_id = auth.uid() and role in ('owner', 'admin')
  );
$$;

-- Authenticated callers (and service_role) must be able to EXECUTE these
-- helpers when RLS policies invoke them.
revoke all on function public.is_org_member(uuid) from public, anon;
revoke all on function public.is_org_admin(uuid) from public, anon;
grant execute on function public.is_org_member(uuid) to authenticated, service_role;
grant execute on function public.is_org_admin(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table organizations        enable row level security;
alter table organization_members enable row level security;

create policy "organizations_select_members"
  on organizations for select
  using (is_org_member(id));

create policy "organizations_insert_authenticated"
  on organizations for insert
  to authenticated
  with check (true);

create policy "organizations_update_admins"
  on organizations for update
  using (is_org_admin(id))
  with check (is_org_admin(id));

create policy "organizations_delete_owners"
  on organizations for delete
  using (
    exists (
      select 1 from organization_members m
      where m.org_id = organizations.id
        and m.user_id = auth.uid()
        and m.role = 'owner'
    )
  );

create policy "organization_members_select_members"
  on organization_members for select
  using (is_org_member(org_id));

-- First member of a brand-new org self-inserts as owner; admins add/remove
-- members thereafter.
create policy "organization_members_insert_first_owner_or_admin"
  on organization_members for insert
  with check (
    (
      user_id = auth.uid()
      and role = 'owner'
      and not exists (
        select 1 from organization_members m where m.org_id = org_id
      )
    )
    or is_org_admin(org_id)
  );

create policy "organization_members_update_admins"
  on organization_members for update
  using (is_org_admin(org_id))
  with check (is_org_admin(org_id));

create policy "organization_members_delete_admins"
  on organization_members for delete
  using (is_org_admin(org_id));
