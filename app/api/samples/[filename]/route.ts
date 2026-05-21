import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";

/** Returns every MCQ for one source_file, grouped by difficulty. */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ filename: string }> }) {
  const { filename } = await ctx.params;
  const decoded = decodeURIComponent(filename);

  const supa = supabaseAdmin();
  const { data, error } = await supa
    .from("samples")
    .select("id,topic,difficulty,type,language,question,options,correct_index,code")
    .eq("source_file", decoded)
    .order("difficulty")
    .order("created_at");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = (data ?? []).map((r) => ({
    id: r.id,
    topic: r.topic,
    difficulty: r.difficulty,
    type: r.type,
    language: r.language,
    question: r.question,
    options: r.options,
    correct_index: r.correct_index,
    code: r.code,
  }));

  const byDifficulty: Record<string, typeof rows> = { easy: [], medium: [], hard: [] };
  for (const r of rows) {
    if (byDifficulty[r.difficulty]) byDifficulty[r.difficulty].push(r);
  }

  return NextResponse.json({
    filename: decoded,
    count: rows.length,
    by_difficulty: byDifficulty,
  });
}
