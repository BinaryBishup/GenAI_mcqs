-- 005 — per-seed variant diversity verdict.
--
-- When a bank is expanded into K variants per seed, sibling variants can come
-- out too similar to each other or to the source. The diversity gate compares
-- siblings and regenerates near-duplicates; anything it still can't make
-- distinct is marked 'duplicate' so it's surfaced and excluded from the default
-- export (the same way plagiarism give-ups are).
--
-- Written best-effort. Apply via the Supabase dashboard SQL editor or MCP.

alter table mcqs add column if not exists diversity_status text default 'ok';  -- 'ok' | 'duplicate'
