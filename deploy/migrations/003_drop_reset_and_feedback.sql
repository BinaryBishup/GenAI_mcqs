-- Migration: remove the forced-password-reset flow and the feedback feature.
--
-- Accounts are now just an email and a password: there is no bootstrap
-- password, no must-reset gate and no in-app password change. The Feedback
-- screen and its API were removed too.
--
--   psql "$DATABASE_URL" -f deploy/migrations/003_drop_reset_and_feedback.sql
--
-- DESTRUCTIVE: dropping `feedback` discards every submission. Archive first if
-- you want to keep them:
--
--   create table feedback_archive as select * from feedback;

begin;

alter table users drop column if exists must_reset_password;

drop table if exists feedback;

commit;
