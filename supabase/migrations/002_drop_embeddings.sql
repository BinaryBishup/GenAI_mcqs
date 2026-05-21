-- 002 — drop embeddings; switch plag check to pg_trgm + (app-side) rapidfuzz.
--
-- Rationale: v1 only needs to catch exact / near-exact copies (minor identifier
-- swaps, light rephrasing). Semantic embeddings are overkill and add a paid
-- dependency (Voyage). pg_trgm + rapidfuzz handles the actual requirement and
-- is essentially free.

drop index if exists plag_corpus_embedding_idx;
drop function if exists match_plag_corpus(vector, int, text);
alter table plag_corpus drop column if exists embedding;

-- match_plag_trgm: trigram-similarity lookup over plag_corpus.
-- Returns the top-N rows whose normalized question is most similar to the
-- input. Uses the existing GIN index on question_norm (already in 001).
create or replace function match_plag_trgm(
  query_text text,
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
    similarity(pc.question_norm, lower(regexp_replace(query_text, '\s+', ' ', 'g'))) as similarity
  from plag_corpus pc
  where (filter_language is null or pc.language = filter_language)
    and pc.question_norm % lower(regexp_replace(query_text, '\s+', ' ', 'g'))
  order by similarity desc
  limit match_count
$$;
