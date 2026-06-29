import { config } from "dotenv";
config({ path: ".env.local" });
import { supabaseAdmin } from "../lib/supabase";
import { env } from "../lib/env";
import { generateDiagram } from "../lib/diagram";

async function main() {
  const runId = process.argv[2] || "8176adf8-26ef-422e-9825-d26858b0f2d3";
  const supa = supabaseAdmin();
  const { data: rows } = await supa.from("mcqs").select("index,question,options,difficulty,image_svg").eq("run_id", runId).not("image_svg", "is", null).order("index");
  if (!rows?.length) { console.log("no images"); process.exit(0); }
  for (const r of rows) {
    const svg = await generateDiagram({
      question: r.question, options: r.options ?? [], difficulty: r.difficulty ?? "medium",
      model: env.modelFor("balanced"),
      instruction: "Redraw so NO text is hidden, clipped, or overlapping any shape, line, or arrow. Paint all text on top with clear backgrounds; enlarge any cramped boxes; keep every label fully legible.",
      existingSvg: r.image_svg,
    });
    if (svg) { await supa.from("mcqs").update({ image_svg: svg }).eq("run_id", runId).eq("index", r.index); console.log(`Q${r.index+1}: redrawn (${svg.length} chars)`); }
    else console.log(`Q${r.index+1}: skipped`);
  }
  process.exit(0);
}
main().catch(e=>{console.error(e);process.exit(1)});
