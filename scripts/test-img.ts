// Scratch generation with create_images=true to exercise diagram-as-code.
//   npx tsx scripts/test-img.ts <count>
import { config } from "dotenv";
config({ path: ".env.local" });
import { runWorkflow } from "../lib/runner";
import type { GenerateRequest } from "../lib/types";

async function main() {
  const count = Number(process.argv[2] || "6");
  const req: GenerateRequest = {
    count,
    topic: "Data structures & algorithms diagrams: binary search trees, linked lists, stacks/queues, graph traversal, and simple flowcharts",
    team: "HACK",
    difficulty: "medium",
    mcq_type: "general",
    languages: [],
    samples: [],
    sample_files: [],
    samples_per_file: 4,
    max_revamp_attempts: 3,
    quality: "balanced",
    grounding: true,
    create_images: true,
    mode: "scratch",
    extra_prompt: "Strongly prefer questions that genuinely need a VISUAL — a tree/graph structure to read, a flowchart to trace, or a figure to interpret. Reference 'the diagram'/'the tree shown' so a diagram is warranted.",
  };
  const { runId, mcqs } = await runWorkflow(req, () => {});
  console.log(`\nrunId: ${runId} (team HACK)\n`);
  mcqs.forEach((m, i) => {
    console.log(`Q${i + 1}. ${m.question.slice(0, 95)}${m.question.length > 95 ? "…" : ""}`);
    console.log(`     image: ${m.image_svg ? `YES (${m.image_svg.length} chars, ${m.image_svg.slice(0, 30)}…)` : "no"} | answer_check=${m.answer_check_status}`);
  });
  console.log(`\n${mcqs.filter((m) => m.image_svg).length}/${mcqs.length} questions got a diagram.`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
