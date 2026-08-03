import { NextRequest, NextResponse } from "next/server";
import { database } from "@/lib/server/db";

export const runtime = "nodejs";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const db = database();

  const [{ data: run, error: runErr }, { data: mcqs, error: mcqErr }] = await Promise.all([
    db.from("runs").select("*").eq("id", id).single(),
    db.from("mcqs").select("*").eq("run_id", id).order("index"),
  ]);
  if (runErr || !run) return NextResponse.json({ error: "run not found" }, { status: 404 });
  if (mcqErr) return NextResponse.json({ error: mcqErr.message }, { status: 500 });

  // Seed lineage: resolve each question's parent_sample_id to the original
  // bank question so reviewers can see the source a variant was cloned from.
  const parentIds = [...new Set((mcqs ?? []).map((m) => m.parent_sample_id).filter(Boolean))] as string[];
  const sourceById = new Map<string, { question: string; options: string[]; correct_index: number; source_file: string; difficulty: string }>();
  if (parentIds.length > 0) {
    const { data: parents } = await db
      .from("samples")
      .select("id,question,options,correct_index,source_file,difficulty")
      .in("id", parentIds);
    for (const p of parents ?? []) {
      sourceById.set(String(p.id), {
        question: p.question,
        options: p.options,
        correct_index: p.correct_index,
        source_file: p.source_file,
        difficulty: p.difficulty,
      });
    }
  }

  return NextResponse.json({
    run,
    mcqs: (mcqs ?? []).map((m) => ({
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
      source_sample: m.parent_sample_id ? sourceById.get(String(m.parent_sample_id)) ?? null : null,
      diversity_status: m.diversity_status ?? undefined,
      review_status: m.review_status ?? null,
      review_reason: m.review_reason ?? null,
    })),
  });
}
