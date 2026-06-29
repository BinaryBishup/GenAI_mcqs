// Quick CLI harness to exercise the generation pipeline for one bank/team and
// print the resulting questions + their similarity/plag/review status, so we can
// tune prompts without the browser.
//   npx tsx scripts/test-gen.ts <team> "<file.xls>" <easy|medium|hard> <count>
import { config } from "dotenv";
config({ path: ".env.local" });

import { runWorkflow } from "../lib/runner";
import type { Difficulty, GenerateRequest, Team } from "../lib/types";

async function main() {
  const team = (process.argv[2] || "Cognitive") as Team;
  const file = process.argv[3] || "Percentage general.xls";
  const difficulty = (process.argv[4] || "medium") as Difficulty;
  const count = Number(process.argv[5] || "6");

  const req: GenerateRequest = {
    count,
    topic: file.replace(/\.xls.?$/i, ""),
    team,
    difficulty,
    mcq_type: "general",
    languages: [],
    samples: [],
    sample_files: [file],
    samples_per_file: 4,
    max_revamp_attempts: 3,
    quality: "balanced",
    grounding: true,
    mode: "sample",
    bank_specs: [{ file, difficulty, count }],
  };

  const notable: string[] = [];
  const { mcqs } = await runWorkflow(req, (e) => {
    if (["revamping", "plag_flagged", "plag_gave_up"].includes(e.type)) {
      notable.push(`${e.type} #${e.data?.index} ${e.data?.reason ?? ""}`);
    }
  });

  console.log(`\n=== ${team} · ${file} · ${difficulty} · ${mcqs.length} questions ===\n`);
  mcqs.forEach((m, i) => {
    console.log(`Q${i + 1}. ${m.question}`);
    m.options.forEach((o, j) => console.log(`   ${j === m.correct_index ? "*" : " "} ${String.fromCharCode(65 + j)}. ${o}`));
    console.log(`   why: ${m.explanation ?? "—"}`);
    console.log(`   [answer_check=${m.answer_check_status} plag=${m.plag_status} diversity=${m.diversity_status ?? "-"}]`);
    if (m.answer_check_notes) console.log(`   note: ${m.answer_check_notes}\n`);
    else console.log("");
  });
  if (notable.length) console.log("Regen/flag events:\n  " + notable.join("\n  "));
  process.exit(0);
}

main().catch((e) => {
  console.error("FAILED:", e);
  process.exit(1);
});
