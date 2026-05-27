/**
 * Restore the JSON files in db-export/ into a fresh Supabase project.
 *
 * Pre-reqs on the target project:
 *   - Run the SQL in supabase/migrations/001_initial.sql first (creates the
 *     schema + extensions + indexes).
 *   - Point .env.local at the NEW project's URL + secret/service-role key.
 *
 * Then: npm run db:restore
 *
 * Idempotent: each table is upserted by primary key.
 */
import { config as dotenvConfig } from "dotenv";
dotenvConfig({ path: ".env.local" });
dotenvConfig({ path: ".env" });

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { createClient } from "@supabase/supabase-js";

// Restore order respects FK dependencies:
//   mcqs.run_id -> runs.id
//   run_events.run_id -> runs.id
const ORDER = ["samples", "plag_corpus", "runs", "mcqs", "run_events"] as const;

const PRIMARY_KEY: Record<string, string> = {
  samples: "id",
  plag_corpus: "id",
  runs: "id",
  mcqs: "id",
  run_events: "id",
};

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SECRET_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("missing NEXT_PUBLIC_SUPABASE_URL or a key");
  console.log(`Restoring into ${url}`);

  const supa = createClient(url, key, { auth: { persistSession: false } });
  const dir = join(process.cwd(), "db-export");

  for (const table of ORDER) {
    const file = join(dir, `${table}.json`);
    if (!existsSync(file)) {
      console.log(`  ${table}: no dump file (skipped)`);
      continue;
    }
    const rows: any[] = JSON.parse(readFileSync(file, "utf-8"));
    if (rows.length === 0) {
      console.log(`  ${table}: 0 rows (skipped)`);
      continue;
    }
    // Chunk inserts so we don't blow past Postgres parameter limits on big tables.
    const CHUNK = 200;
    const pk = PRIMARY_KEY[table];
    for (let i = 0; i < rows.length; i += CHUNK) {
      const slice = rows.slice(i, i + CHUNK);
      const { error } = await supa.from(table).upsert(slice, { onConflict: pk });
      if (error) throw new Error(`restore ${table} (chunk ${i}): ${error.message}`);
    }
    console.log(`  ${table}: ${rows.length} rows upserted`);
  }

  console.log("\nDone.");
}

main().catch((e) => { console.error(e); process.exit(1); });
