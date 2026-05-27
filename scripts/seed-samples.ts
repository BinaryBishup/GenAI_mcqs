/**
 * Seed the `samples` table from the legacy .xls workbooks in ../samples/.
 *
 * Run with: `npm run seed:samples`
 *
 * Parsing lives in lib/xls-parse.ts (shared with the upload API route).
 */
import { config as dotenvConfig } from "dotenv";
// Next.js convention: prefer .env.local for secrets, fall back to .env.
dotenvConfig({ path: ".env.local" });
dotenvConfig({ path: ".env" });
import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { createClient } from "@supabase/supabase-js";
import { parseWorkbookBuffer, type SampleRow } from "../lib/xls-parse";

const SAMPLES_DIR = join(process.cwd(), "samples");

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  // Prefer the secret / service-role key for writes; fall back to the publishable
  // key for the v1 single-user setup where RLS is off.
  const key =
    process.env.SUPABASE_SECRET_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error("set NEXT_PUBLIC_SUPABASE_URL and a key (SUPABASE_SECRET_KEY / SERVICE_ROLE_KEY / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)");
  }
  const supa = createClient(url, key, { auth: { persistSession: false } });

  const files = readdirSync(SAMPLES_DIR).filter((f) => f.toLowerCase().endsWith(".xls"));
  console.log(`Found ${files.length} sample workbooks in ${SAMPLES_DIR}`);

  let total = 0;
  for (const f of files) {
    const buf = readFileSync(join(SAMPLES_DIR, f));
    const rows = parseWorkbookBuffer(buf, f);
    if (rows.length === 0) {
      console.log(`  ${f}: 0 rows (skipped)`);
      continue;
    }
    // Delete prior rows for this file first so reruns are idempotent.
    await supa.from("samples").delete().eq("source_file", f);
    const chunks: SampleRow[][] = [];
    for (let i = 0; i < rows.length; i += 200) chunks.push(rows.slice(i, i + 200));
    for (const chunk of chunks) {
      const { error } = await supa.from("samples").insert(chunk);
      if (error) throw new Error(`insert ${f}: ${error.message}`);
    }
    console.log(`  ${f}: ${rows.length} rows`);
    total += rows.length;
  }
  console.log(`\nDone. ${total} samples inserted.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
