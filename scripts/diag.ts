// Diagnose sample-faithfulness: does each generated variant mirror ITS seed's
// option-length/format, and are all sample "types" covered?
//   npx tsx scripts/diag.ts <count>
import { config } from "dotenv";
config({ path: ".env.local" });
import { runWorkflow } from "../lib/runner";
import { supabaseAdmin } from "../lib/supabase";
import type { Difficulty, GenerateRequest } from "../lib/types";

const wc = (s: string) => (s || "").trim().split(/\s+/).filter(Boolean).length;
const optAvg = (opts: string[]) => { const w = opts.map(wc); return w.reduce((a, b) => a + b, 0) / w.length; };

async function main() {
  const file = "Project Management general.xls";
  const diff: Difficulty = "medium";
  const count = Number(process.argv[2] || "14");
  const supa = supabaseAdmin();
  const { data: seeds } = await supa.from("samples").select("id,question,options").eq("source_file", file).eq("difficulty", diff);
  const seedMap = new Map((seeds || []).map((s: { id: string; question: string; options: string[] }) => [s.id, s]));

  const req: GenerateRequest = {
    count, topic: "Project Management", team: "Domain", difficulty: diff, mcq_type: "general",
    languages: [], samples: [], sample_files: [file], samples_per_file: 4, max_revamp_attempts: 3,
    quality: "balanced", grounding: true, mode: "sample", bank_specs: [{ file, difficulty: diff, count }],
  };
  const { mcqs } = await runWorkflow(req, () => {});

  const usage = new Map<string, number>();
  let drift = 0;
  console.log(`\n=== ${count} variants from ${file} [${diff}] (pool=${seeds?.length}) ===\n`);
  for (const m of mcqs) {
    const pid = (m.parent_sample_id as string) || "none";
    usage.set(pid, (usage.get(pid) || 0) + 1);
    const vAvg = optAvg(m.options);
    const seed = seedMap.get(pid);
    if (seed) {
      const sAvg = optAvg(seed.options);
      const d = Math.abs(vAvg - sAvg);
      if (d > 2) drift++;
      console.log(`seed opt~${sAvg.toFixed(1)}w stem ${wc(seed.question)}w | variant opt~${vAvg.toFixed(1)}w stem ${wc(m.question)}w${d > 2 ? "   <-- DRIFT" : ""}`);
    } else {
      console.log(`(no seed)              | variant opt~${vAvg.toFixed(1)}w`);
    }
  }
  console.log(`\nCoverage: ${usage.size} distinct seeds used of ${seeds?.length} | format drift (>2w): ${drift}/${mcqs.length}`);
  const overUsed = [...usage.entries()].filter(([, c]) => c > 1);
  if (overUsed.length) console.log(`Seeds reused: ${overUsed.map(([, c]) => c).join(",")}`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
