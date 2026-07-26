-- Tags — team-scoped labels for grouping generations (runs) and sample banks,
-- so a user assembling content for a client can filter to just that set.
-- A tag belongs to one team and is shared by everyone who can view that team.

create table if not exists tags (
  id          uuid primary key default gen_random_uuid(),
  team        text not null,
  name        text not null,
  color       text not null default '#7AB52C',
  created_by  uuid,
  created_at  timestamptz not null default now(),
  unique (team, name)
);

create index if not exists tags_team_idx on tags (team);

-- Membership rows. item_type says whether item_id is a run id (uuid, as text) or
-- a sample bank filename (samples are keyed by source_file / filename, not a uuid),
-- so item_id is text to hold either.
create table if not exists tag_items (
  id          uuid primary key default gen_random_uuid(),
  tag_id      uuid not null references tags(id) on delete cascade,
  item_type   text not null check (item_type in ('run','sample')),
  item_id     text not null,
  created_at  timestamptz not null default now(),
  unique (tag_id, item_type, item_id)
);

create index if not exists tag_items_tag_id_idx on tag_items (tag_id);
