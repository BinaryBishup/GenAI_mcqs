-- Reference documents uploaded in the create-from-scratch wizard, persisted
-- (as their assessable-content digest) so authors can reuse them in later sets
-- without re-uploading.
create table if not exists scratch_docs (
  id uuid primary key default gen_random_uuid(),
  team text not null,
  name text not null,
  digest text not null,
  uploaded_by text,
  created_at timestamptz not null default now()
);

create index if not exists scratch_docs_team_idx on scratch_docs (team, created_at desc);
