/*
  RAG knowledge store (general farming questions). The chatbot searches these chunks and answers only from them
  (plus the field's own data). Embeddings: OpenAI text-embedding-3-small = 1536 numbers per chunk.
  Fill it with scripts/ingest-knowledge.mjs. Chunks are public reference text (no personal data).
*/

create extension if not exists vector with schema extensions;

create table if not exists public.knowledge_chunks (
  id         bigint generated always as identity primary key,
  source_id  text references public.sources(id),
  title      text not null,
  url        text,
  content    text not null,
  embedding  extensions.vector(1536) not null,
  created_at timestamptz not null default now()
);

create index if not exists knowledge_chunks_embedding_idx
  on public.knowledge_chunks using hnsw (embedding extensions.vector_cosine_ops);

alter table public.knowledge_chunks enable row level security;
drop policy if exists knowledge_chunks_read on public.knowledge_chunks;
create policy knowledge_chunks_read on public.knowledge_chunks for select to authenticated using (true);

create or replace function public.match_knowledge(
  query_embedding extensions.vector(1536),
  match_count     int   default 5,
  min_similarity  float default 0.0
)
returns table (id bigint, source_id text, title text, url text, content text, similarity float)
language sql stable
set search_path = public, extensions
as $$
  select k.id, k.source_id, k.title, k.url, k.content, 1 - (k.embedding <=> query_embedding) as similarity
    from public.knowledge_chunks k
   where 1 - (k.embedding <=> query_embedding) >= min_similarity
   order by k.embedding <=> query_embedding
   limit least(match_count, 20)
$$;
