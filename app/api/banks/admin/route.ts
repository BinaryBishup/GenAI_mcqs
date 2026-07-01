import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { getUserTeam } from "@/lib/team";

export const runtime = "nodejs";

/**
 * GET /api/banks/admin — the shared Admin inventory: every run that has been
 * published, across ALL teams, with its questions. Any authenticated user can
 * read it (it's the shared pool). Rejected/duplicate questions are excluded so
 * the inventory only holds shippable questions.
 */
export async function GET(req: NextRequest) {
  const { team } = await getUserTeam(req);
  if (!team) return NextResponse.json({ error: "not authenticated" }, { status: 401 });

  const supa = supabaseAdmin();
  const { data: runs, error } = await supa
    .from("runs")
    .select("id,topic,team,difficulty,mcq_type,published_at,published_by,finalised_by")
    .not("published_at", "is", null)
    .order("published_at", { ascending: false })
    .limit(200);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const ids = (runs ?? []).map((r) => r.id);
  const byRun: Record<string, any[]> = {};
  if (ids.length) {
    const { data: mcqs } = await supa
      .from("mcqs")
      .select("run_id,index,type,topic,difficulty,question,options,correct_index,explanation,image_svg,review_status")
      .in("run_id", ids)
      .order("index");
    for (const m of mcqs ?? []) {
      // Exclude questions a reviewer explicitly rejected or flagged as duplicate.
      if (m.review_status === "rejected" || m.review_status === "duplicate") continue;
      (byRun[m.run_id] ??= []).push({
        index: m.index,
        type: m.type,
        topic: m.topic,
        difficulty: m.difficulty,
        question: m.question,
        options: m.options,
        correct_index: m.correct_index,
        explanation: m.explanation,
        image_svg: m.image_svg ?? null,
      });
    }
  }

  const banks = (runs ?? []).map((r) => ({
    id: r.id,
    topic: r.topic,
    team: r.team,
    difficulty: r.difficulty,
    mcq_type: r.mcq_type,
    published_at: r.published_at,
    published_by: r.published_by,
    questions: byRun[r.id] ?? [],
    count: (byRun[r.id] ?? []).length,
  }));

  return NextResponse.json({ count: banks.length, banks });
}
