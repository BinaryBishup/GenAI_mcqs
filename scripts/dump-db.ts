/**
 * Dump every public table from the current Supabase project to db-export/*.json.
 * The schema is already in supabase/migrations/001_initial.sql so the new
 * project just needs the migration applied first; this script handles data.
 *
 * Run with: npm run db:dump
 */
import { config as dotenvConfig } from "dotenv";
dotenvConfig({ path: ".env.local" });
dotenvConfig({ path: ".env" });

import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { createClient } from "@supabase/supabase-js";

const TABLES = [
  // Order doesn't matter for dump — only for restore (handled in restore-db.ts).
  "samples",
  "plag_corpus",
  "runs",
  "mcqs",
  "run_events",
] as const;

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SECRET_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("missing NEXT_PUBLIC_SUPABASE_URL or a key");

  const supa = createClient(url, key, { auth: { persistSession: false } });
  const outDir = join(process.cwd(), "db-export");
  mkdirSync(outDir, { recursive: true });

  const manifest: Record<string, number> = {};
  for (const t of TABLES) {
    // Paginate in case any table grows beyond the 1000-row default limit.
    const PAGE = 1000;
    let from = 0;
    const rows: any[] = [];
    while (true) {
      const { data, error } = await supa.from(t).select("*").range(from, from + PAGE - 1);
      if (error) throw new Error(`dump ${t}: ${error.message}`);
      if (!data || data.length === 0) break;
      rows.push(...data);
      if (data.length < PAGE) break;
      from += PAGE;
    }
    const path = join(outDir, `${t}.json`);
    writeFileSync(path, JSON.stringify(rows, null, 2));
    manifest[t] = rows.length;
    console.log(`  ${t}: ${rows.length} rows -> ${path}`);
  }

  writeFileSync(
    join(outDir, "manifest.json"),
    JSON.stringify({
      exported_at: new Date().toISOString(),
      source_url: url,
      tables: manifest,
    }, null, 2),
  );
  console.log(`\nDone. ${Object.values(manifest).reduce((a, b) => a + b, 0)} total rows exported.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
