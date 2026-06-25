import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { checkAnswer } from "@/lib/answer-check";
import type { MCQ } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Persist an edit to a single generated MCQ (manual or AI-assisted), then
 * re-run the independent answer-check so the verdict reflects the edited
 * content. Keyed by (run_id, index) — stable across reopen/export.
 *
 * Body: { run_id: string, index: number, mcq: MCQ }
 * Returns: { mcq: MCQ } with refreshed answer_check_* fields.
 */
export async function PATCH(req: NextRequest) {
  let body: { run_id?: string; index?: number; mcq?: MCQ };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const { run_id, index, mcq } = body;
  if (!run_id || typeof index !== "number" || !mcq) {
    return NextResponse.json({ error: "run_id, index and mcq are required" }, { status: 400 });
  }
  if (!Array.isArray(mcq.options) || mcq.options.length !== 4) {
    return NextResponse.json({ error: "mcq must have exactly 4 options" }, { status: 400 });
  }
  const correct = Math.max(0, Math.min(3, Number(mcq.correct_index ?? 0)));

  const supa = supabaseAdmin();

  // 1) Persist the editable fields.
  const { error: updErr } = await supa
    .from("mcqs")
    .update({
      type: mcq.type === "code" ? "code" : "general",
      question: String(mcq.question ?? ""),
      options: mcq.options.map(String),
      correct_index: correct,
      explanation: mcq.explanation ?? null,
      snippet_language: mcq.snippet?.language ?? null,
      snippet_code: mcq.snippet?.code ?? null,
    })
    .eq("run_id", run_id)
    .eq("index", index);
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

  // 2) Re-run the independent answer-check on the edited question.
  const edited: MCQ = { ...mcq, correct_index: correct };
  const check = await checkAnswer(edited);
  edited.answer_check_status = check.status;
  edited.answer_check_index = check.index;
  edited.answer_check_notes = check.notes;

  // Best-effort persist of the verdict (columns exist only after migration 003).
  try {
    const { error } = await supa
      .from("mcqs")
      .update({
        answer_check_status: check.status,
        answer_check_index: check.index,
        answer_check_notes: check.notes,
      })
      .eq("run_id", run_id)
      .eq("index", index);
    if (error) console.warn(`[PATCH /api/mcqs] verdict not persisted (apply migration 003): ${error.message}`);
  } catch (e) {
    console.warn(`[PATCH /api/mcqs] verdict persist threw: ${(e as Error).message}`);
  }

  return NextResponse.json({ mcq: edited });
}
