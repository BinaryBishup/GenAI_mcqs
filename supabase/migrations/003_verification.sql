-- 003 — independent answer-check verification + run grounding/mode metadata.
--
-- Adds columns the app writes best-effort: generation still works if this
-- migration hasn't been applied yet (the writes are wrapped in try/catch and
-- the status streams live over SSE regardless). Applying it "lights up"
-- persistence so the verdict survives reopen + export filtering.
--
-- Apply: paste into the Supabase dashboard SQL editor (this project has no
-- CLI/psql configured), or run via the Supabase MCP.

-- ---------------------------------------------------------------------------
-- mcqs: per-question answer-check verdict (non-code correctness check).
--   answer_check_status:
--     'pending'   — not yet checked
--     'agree'     — independent re-derivation matched the stated correct option
--     'disagree'  — independent re-derivation picked a different option
--     'uncertain' — checker couldn't commit to a single answer
--     'skipped'   — not applicable (e.g. code MCQ handled by Judge0, or check off)
-- ---------------------------------------------------------------------------
alter table mcqs add column if not exists answer_check_status   text default 'pending';
alter table mcqs add column if not exists answer_check_index    int;     -- option index the checker believed correct
alter table mcqs add column if not exists answer_check_notes     text;    -- one-line rationale from the checker

-- ---------------------------------------------------------------------------
-- runs: provenance/config so the Generations list can label scratch vs sample
-- runs and show whether grounding was used.
-- ---------------------------------------------------------------------------
alter table runs add column if not exists mode            text default 'sample';   -- 'sample' | 'scratch'
alter table runs add column if not exists grounded        boolean default false;   -- was Tavily grounding used
alter table runs add column if not exists question_kinds  jsonb default '[]'::jsonb; -- scratch-mode: ['code','application','analysis']
