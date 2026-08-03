-- Migration: drop the Judge0 code-execution columns.
--
-- Judge0 was removed from the pipeline; correctness is now established by the
-- model-based verify pass (blind solve + arbitrate) recorded in the
-- answer_check_* columns. These three columns are no longer read or written.
--
--   psql "$DATABASE_URL" -f deploy/migrations/002_drop_judge0_columns.sql
--
-- DESTRUCTIVE and OPTIONAL: this discards the stored verification results of
-- historical runs. The application works either way — leaving the columns in
-- place costs nothing but a little clutter. Skip this file if you want to keep
-- the history, or archive it first:
--
--   create table mcqs_judge0_archive as
--     select id, run_id, index, code_verified, code_actual_output, code_fix
--     from mcqs where code_verified is not null;

begin;

alter table mcqs
  drop column if exists code_verified,
  drop column if exists code_actual_output,
  drop column if exists code_fix;

commit;
