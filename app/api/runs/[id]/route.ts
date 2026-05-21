import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const supa = supabaseAdmin();

  const [{ data: run, error: runErr }, { data: mcqs, error: mcqErr }] = await Promise.all([
    supa.from("runs").select("*").eq("id", id).single(),
    supa.from("mcqs").select("*").eq("run_id", id).order("index"),
  ]);
  if (runErr || !run) return NextResponse.json({ error: "run not found" }, { status: 404 });
  if (mcqErr) return NextResponse.json({ error: mcqErr.message }, { status: 500 });

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
      plag_status: m.plag_status,
      plag_matches: m.plag_matches,
      plag_attempts: m.plag_attempts,
      code_verified: m.code_verified,
      code_actual_output: m.code_actual_output,
      code_fix: m.code_fix,
    })),
  });
}
