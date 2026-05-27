# DB export for migration

Snapshot of the old Supabase project (`qypaxhyzgyijfexkfvsk`) — REST API got
quota-blocked, so this was pulled via the Supabase Management API SQL endpoint.

## What's here

| File | What | When to run |
|---|---|---|
| `01-schema.sql` | DDL: extensions (`vector`, `pg_trgm`), tables, indexes, RPCs (`match_plag_trgm`). Concatenation of `supabase/migrations/001_initial.sql` + `002_drop_embeddings.sql`. | **First**, on the new project. |
| `02-data.sql` | All rows for `samples` (111), `runs` (32), `mcqs` (241), `run_events` (1132). Uses `jsonb_populate_recordset` + `ON CONFLICT DO NOTHING` so it's idempotent. | **Second**, after the schema. |
| `*.json` | Raw per-table dumps. Kept around in case the SQL needs to be re-generated (see `scripts/build-data-sql.py`). | — |
| `manifest.json` | Row counts + source URL + export timestamp. | — |

`plag_corpus` is empty in the source (0 rows) and is included only for completeness.

## How to restore into a new Supabase project

1. Create the new project in the new account.
2. Open the project's **SQL Editor**.
3. Paste & run `01-schema.sql`.
4. Paste & run `02-data.sql`. (It's ~1.7 MB. If the web editor chokes, use
   `psql "$DATABASE_URL" -f db-export/02-data.sql` from a shell with the new
   project's connection string.)
5. Update `.env.local` to point at the new project:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
   - `SUPABASE_SECRET_KEY`
6. Update the same three vars on Vercel → redeploy.

## Regenerating the SQL from JSON

If you edit the JSON dumps (e.g., trim out test runs) and want to rebuild
`02-data.sql`:

```sh
python3 scripts/build-data-sql.py
```

## Note on security

RLS was disabled on every table in the source project. That's fine for the
current single-user setup but worth re-enabling on the new project once
auth/users are introduced.
