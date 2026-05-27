#!/usr/bin/env python3
"""Build db-export/02-data.sql from the per-table JSON dumps.

For each table, emit:
  INSERT INTO {table}
  SELECT * FROM jsonb_populate_recordset(NULL::{table},
    $json$ ... rows ... $json$::jsonb)
  ON CONFLICT (id) DO NOTHING;

Order respects FK dependencies: runs before mcqs / run_events.
"""
import json
from pathlib import Path

DIR = Path(__file__).resolve().parent.parent / "db-export"

# (table, on_conflict_target) — None means no ON CONFLICT clause.
ORDER = [
    ("samples", "id"),
    ("plag_corpus", "id"),
    ("runs", "id"),
    ("mcqs", "id"),
    ("run_events", "id"),
]

def render(table: str, pk: str | None, rows: list) -> str:
    if not rows:
        return f"-- {table}: 0 rows, skipped\n\n"
    # Use a custom dollar-quote tag unlikely to collide with the data.
    tag = "$mcq$"
    payload = json.dumps(rows, ensure_ascii=False).replace(tag, tag + "_")
    out = [f"-- {table}: {len(rows)} rows"]
    out.append(f"INSERT INTO {table}")
    out.append(f"SELECT * FROM jsonb_populate_recordset(NULL::{table}, {tag}{payload}{tag}::jsonb)")
    if pk:
        out.append(f"ON CONFLICT ({pk}) DO NOTHING;")
    else:
        out[-1] += ";"
    return "\n".join(out) + "\n\n"

def main():
    parts = [
        "-- Data restore for MCQ Workflow.",
        "-- Pre-req: run supabase/migrations/001_initial.sql and 002_drop_embeddings.sql first.",
        "-- Then execute this file via psql or the Supabase SQL editor.",
        "",
        "BEGIN;",
        "",
    ]
    counts = {}
    for table, pk in ORDER:
        path = DIR / f"{table}.json"
        rows = json.loads(path.read_text())
        counts[table] = len(rows)
        parts.append(render(table, pk, rows))
    parts.append("COMMIT;")
    parts.append("")
    out = DIR / "02-data.sql"
    out.write_text("\n".join(parts))
    print(f"Wrote {out} ({out.stat().st_size:,} bytes)")
    for t, n in counts.items():
        print(f"  {t}: {n}")

if __name__ == "__main__":
    main()
