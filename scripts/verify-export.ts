import { config } from "dotenv";
config({ path: ".env.local" });
import * as XLSX from "xlsx";
import { supabaseAdmin } from "../lib/supabase";
import { buildMettlWorkbook } from "../lib/mettl-export";
import type { MCQ } from "../lib/types";

async function main() {
  const supa = supabaseAdmin();
  // a few real questions incl. an image one
  const { data } = await supa.from("mcqs").select("*").eq("run_id", "8176adf8-26ef-422e-9825-d26858b0f2d3").order("index").limit(3);
  const mcqs: MCQ[] = (data ?? []).map((r: any) => ({
    id: r.id, type: r.type, topic: r.topic, difficulty: r.difficulty, question: r.question,
    options: r.options, correct_index: r.correct_index, explanation: r.explanation,
    snippet: r.snippet_code ? { language: r.snippet_language, code: r.snippet_code } : null,
    image_svg: r.image_svg,
  }));
  const bytes = buildMettlWorkbook(mcqs, { topicOverride: "Data Structures" });
  // re-parse what we produced
  const wb = XLSX.read(bytes, { type: "array" });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets["MCQ"], { header: 1, defval: "" }) as any[][];
  // template headers
  const tpl = XLSX.readFile("Mettl-Bulk-Upload-Template-General-Questions-v14.xls");
  const tplHdr = (XLSX.utils.sheet_to_json(tpl.Sheets["MCQ"], { header: 1 })[0]) as string[];
  console.log("sheet name:", wb.SheetNames.join(","));
  console.log("headers MATCH template:", JSON.stringify(rows[0]) === JSON.stringify(tplHdr));
  console.log("header diff:", rows[0].map((h,i)=> h===tplHdr[i]?".":`[${i}] '${h}' vs '${tplHdr[i]}'`).filter(x=>x!==".").join(" | ") || "none");
  const r = rows[1];
  console.log("\nrow1: difficulty=", r[1], "| correct=", r[9], "| choice1=", String(r[3]).slice(0,30), "| qtext has svg:", String(r[2]).includes("<svg"));
  console.log("row1 question text (first 120):", String(r[2]).slice(0,120));
  process.exit(0);
}
main().catch(e=>{console.error(e);process.exit(1)});
