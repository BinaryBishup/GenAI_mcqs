-- User feedback, collected from the in-app Feedback screen. Team-scoped like
-- everything else; no RLS (server writes via the service key / DATABASE_URL).
create table if not exists feedback (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  team text not null,
  user_id uuid,
  user_name text,
  category text not null default 'general',
  rating int check (rating between 1 and 5),
  message text not null,
  page text
);

create index if not exists feedback_team_idx on feedback (team, created_at desc);
