-- MCQ Workflow — initial schema.
-- Single-user v1: no RLS, no auth. Add Supabase Auth + RLS in a later migration.

create extension if not exists vector;
create extension if not exists pg_trgm;

-- ---------------------------------------------------------------------------
-- samples: ground-truth MCQs imported from the legacy .xls workbooks.
-- ---------------------------------------------------------------------------
create table if not exists samples (
  id            uuid primary key default gen_random_uuid(),
  source_file   text not null,
  topic         text not null,
  difficulty    text not null check (difficulty in ('easy','medium','hard')),
  type          text not null check (type in ('general','code')),
  language      text,
  question      text not null,
  options       jsonb not null,
  correct_index int  not null,
  code          text,
  created_at    timestamptz not null default now()
);

create index if not exists samples_source_file_idx on samples (source_file);
create index if not exists samples_topic_trgm_idx  on samples using gin (topic gin_trgm_ops);
create index if not exists samples_language_idx    on samples (language);

-- ---------------------------------------------------------------------------
-- plag_corpus: scraped MCQs from public sources, embedded for similarity lookup.
-- ---------------------------------------------------------------------------
create table if not exists plag_corpus (
  id            bigserial primary key,
  source        text not null,                 -- 'sanfoundry' | 'indiabix' | 'javatpoint' | ...
  url           text not null,
  topic         text,
  language      text,
  question      text not null,
  question_norm text not null,                  -- lowercased / whitespace-collapsed
  code          text,
  embedding     vector(1024),                   -- voyage-3 = 1024 dims
  created_at    timestamptz not null default now(),
  unique (source, url)
);

create index if not exists plag_corpus_source_idx     on plag_corpus (source);
create index if not exists plag_corpus_language_idx   on plag_corpus (language);
create index if not exists plag_corpus_q_trgm_idx     on plag_corpus using gin (question_norm gin_trgm_ops);
-- ivfflat needs ANALYZE after seeding. lists≈sqrt(rowcount); tune after corpus build.
create index if not exists plag_corpus_embedding_idx
  on plag_corpus using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

-- ---------------------------------------------------------------------------
-- runs: one row per generation request.
-- ---------------------------------------------------------------------------
create table if not exists runs (
  id               uuid primary key default gen_random_uuid(),
  status           text not null default 'pending'
                    check (status in ('pending','generating','plagchecking','revamping','verifying','done','error')),
  topic            text not null,
  difficulty       text not null,
  mcq_type         text not null,
  count            int  not null,
  quality          text not null,
  languages        jsonb not null default '[]'::jsonb,
  sample_file_ids  jsonb not null default '[]'::jsonb,
  samples_per_file int  not null default 4,
  max_revamp_attempts int not null default 3,
  error_message    text,
  started_at       timestamptz not null default now(),
  finished_at      timestamptz
);

create index if not exists runs_started_at_idx on runs (started_at desc);
create index if not exists runs_status_idx     on runs (status);

-- ---------------------------------------------------------------------------
-- mcqs: per-run generated questions, with plag + verify state.
-- ---------------------------------------------------------------------------
create table if not exists mcqs (
  id                 uuid primary key default gen_random_uuid(),
  run_id             uuid not null references runs(id) on delete cascade,
  index              int  not null,
  type               text not null check (type in ('general','code')),
  topic              text not null,
  difficulty         text not null,
  question           text not null,
  options            jsonb not null,
  correct_index      int  not null,
  explanation        text,
  snippet_language   text,
  snippet_code       text,
  plag_status        text not null default 'pending'
                       check (plag_status in ('pending','unique','flagged','revamped','gave_up')),
  plag_matches       jsonb not null default '[]'::jsonb,
  plag_attempts      int  not null default 0,
  code_verified      boolean,
  code_actual_output text,
  code_fix           text,
  created_at         timestamptz not null default now(),
  unique (run_id, index)
);

create index if not exists mcqs_run_id_idx on mcqs (run_id);

-- ---------------------------------------------------------------------------
-- run_events: SSE replay / debug log. Trimmed by a retention job later.
-- ---------------------------------------------------------------------------
create table if not exists run_events (
  id      bigserial primary key,
  run_id  uuid not null references runs(id) on delete cascade,
  type    text not null,
  data    jsonb not null,
  ts      timestamptz not null default now()
);

create index if not exists run_events_run_id_ts_idx on run_events (run_id, ts);

-- ---------------------------------------------------------------------------
-- match_plag_corpus: KNN helper, used by the plag-check API.
-- ---------------------------------------------------------------------------
create or replace function match_plag_corpus(
  query_embedding vector(1024),
  match_count int default 5,
  filter_language text default null
)
returns table (
  id bigint,
  source text,
  url text,
  question text,
  similarity float
)
language sql stable
as $$
  select
    pc.id,
    pc.source,
    pc.url,
    pc.question,
    1 - (pc.embedding <=> query_embedding) as similarity
  from plag_corpus pc
  where pc.embedding is not null
    and (filter_language is null or pc.language = filter_language)
  order by pc.embedding <=> query_embedding
  limit match_count
$$;
