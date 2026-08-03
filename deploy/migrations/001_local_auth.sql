-- Migration: move authentication into this database.
--
-- Apply to an EXISTING database that predates self-hosted auth. A database
-- created from deploy/schema.sql already has everything here — this file only
-- exists so a running environment can be upgraded in place.
--
--   psql "$DATABASE_URL" -f deploy/migrations/001_local_auth.sql
--
-- Afterwards, provision accounts with `npm run user:create` — the old external
-- identity provider held the password hashes and none are carried over.

begin;

create table if not exists users (
  id                  uuid primary key default gen_random_uuid(),
  email               text not null,
  password_hash       text not null,
  full_name           text,
  team                text not null check (team = any (array['HACK','Cognitive','Domain','Psychometric','SEG','ALL'])),
  teams               text[] not null default '{}',
  is_active           boolean not null default true,
  created_at          timestamptz not null default now(),
  last_login_at       timestamptz
);

create unique index if not exists users_email_key on users (lower(email));

-- `profiles` was the user→team mapping kept alongside the external auth
-- provider. `users` supersedes it; carry across any names and teams still
-- recorded there so existing rows are not silently lost, then drop it.
do $$
begin
  if exists (select 1 from information_schema.tables
             where table_schema = 'public' and table_name = 'profiles') then
    insert into users (id, email, password_hash, full_name, team)
    select p.id,
           -- No address was stored on profiles; park a placeholder that cannot
           -- collide and cannot be signed in to until an admin sets it.
           'migrated+' || p.id::text || '@invalid.local',
           '!',                        -- not a valid bcrypt hash: login always fails
           p.full_name,
           coalesce(p.team, 'HACK')
    from profiles p
    where not exists (select 1 from users u where u.id = p.id);

    drop table profiles;
  end if;
end $$;

commit;
