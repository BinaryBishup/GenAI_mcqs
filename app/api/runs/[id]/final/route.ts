import { NextRequest, NextResponse } from "next/server";
import { database } from "@/lib/server/db";

export const runtime = "nodejs";

/** Authoritative final list. Used as a fallback when SSE drops mid-stream. */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const db = database();

  const { data, error } = await db
    .from("mcqs")
    .select("*")
    .eq("run_id", id)
    .order("index");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const questions = (data ?? []).map((m) => ({
    id: m.id,
    type: m.type,
    topic: m.topic,
    difficulty: m.difficulty,
    question: m.question,
    options: m.options,
    correct_index: m.correct_index,
    explanation: m.explanation,
    snippet: m.snippet_code ? { language: m.snippet_language, code: m.snippet_code } : null,
    image_svg: m.image_svg ?? null,
    plag_status: m.plag_status,
    plag_matches: m.plag_matches,
    plag_attempts: m.plag_attempts,
    answer_check_status: m.answer_check_status ?? undefined,
    answer_check_index: m.answer_check_index ?? null,
    answer_check_notes: m.answer_check_notes ?? null,
    parent_sample_id: m.parent_sample_id ?? null,
    diversity_status: m.diversity_status ?? undefined,
  }));

  return NextResponse.json({ run_id: id, questions });
}
