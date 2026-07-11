-- 0008_knowledge.sql
-- Per-org knowledge base used to ground SMS (and later voice) replies —
-- hours, booking instructions, services, FAQs, policies. The agent reads
-- active rows via the service-role client; dashboard users manage them
-- through RLS-scoped CRUD.

create type knowledge_kind as enum (
  'general',
  'booking',
  'hours',
  'services',
  'faq',
  'policy'
);

create table knowledge (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations (id) on delete cascade,
  kind        knowledge_kind not null default 'general',
  title       text not null,
  content     text not null,
  metadata    jsonb not null default '{}'::jsonb,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index knowledge_org_id_idx
  on knowledge (org_id)
  where is_active;

create index knowledge_org_kind_idx
  on knowledge (org_id, kind)
  where is_active;

create trigger knowledge_set_updated_at
  before update on knowledge
  for each row execute function set_updated_at();

alter table knowledge enable row level security;

create policy "knowledge_select_members"
  on knowledge for select
  using (is_org_member(org_id));

create policy "knowledge_insert_admins"
  on knowledge for insert
  with check (is_org_admin(org_id));

create policy "knowledge_update_admins"
  on knowledge for update
  using (is_org_admin(org_id))
  with check (is_org_admin(org_id));

create policy "knowledge_delete_admins"
  on knowledge for delete
  using (is_org_admin(org_id));
