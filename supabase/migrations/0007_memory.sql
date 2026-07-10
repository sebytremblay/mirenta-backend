-- 0007_memory.sql
-- Contact-level memory across interactions: rolling summaries live on
-- contact_state.memory_summary; this table stores embedded chunks for
-- semantic recall by memory/store.py.

create extension if not exists vector;

create type memory_kind as enum (
  'summary',           -- periodic rolled-up summaries
  'fact',              -- extracted durable facts ("prefers email", "closes Fridays")
  'transcript_chunk',  -- chunked interaction transcripts
  'preference'
);

create table contact_memory (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references organizations (id) on delete cascade,
  contact_id      uuid not null references contacts (id) on delete cascade,
  interaction_id  uuid references interactions (id) on delete set null,  -- provenance
  kind            memory_kind not null,
  content         text not null,
  embedding       vector(1536),                    -- text-embedding-3-small; adjust to your model
  metadata        jsonb not null default '{}'::jsonb,
  superseded_by   uuid references contact_memory (id),  -- soft-invalidate stale facts
  created_at      timestamptz not null default now()
);

create index contact_memory_org_id_idx  on contact_memory (org_id);
create index contact_memory_contact_idx on contact_memory (contact_id, created_at desc);
create index contact_memory_kind_idx    on contact_memory (contact_id, kind);

-- HNSW: good recall/speed with no training step (works on empty tables,
-- unlike ivfflat). Cosine distance to match normalized OpenAI embeddings.
create index contact_memory_embedding_idx
  on contact_memory using hnsw (embedding vector_cosine_ops);

alter table contact_memory enable row level security;

-- ---------------------------------------------------------------------------
-- Semantic search scoped to one contact (call via supabase.rpc('match_contact_memory', ...))
-- ---------------------------------------------------------------------------
create or replace function match_contact_memory(
  p_contact_id      uuid,
  p_query_embedding vector(1536),
  p_match_count     integer default 8,
  p_min_similarity  double precision default 0.3
)
returns table (
  id         uuid,
  kind       memory_kind,
  content    text,
  metadata   jsonb,
  similarity double precision,
  created_at timestamptz
)
language sql
stable
as $$
  select
    m.id,
    m.kind,
    m.content,
    m.metadata,
    1 - (m.embedding <=> p_query_embedding) as similarity,
    m.created_at
  from contact_memory m
  where m.contact_id = p_contact_id
    and m.superseded_by is null
    and m.embedding is not null
    and 1 - (m.embedding <=> p_query_embedding) >= p_min_similarity
  order by m.embedding <=> p_query_embedding
  limit p_match_count;
$$;
