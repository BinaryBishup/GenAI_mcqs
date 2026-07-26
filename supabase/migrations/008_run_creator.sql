-- Track who started each generation run. Stamped server-side from the verified
-- JWT in POST /api/generate; older runs stay null and display as "—".
alter table runs add column if not exists created_by uuid;
alter table runs add column if not exists created_by_name text;
