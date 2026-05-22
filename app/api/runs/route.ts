import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";

/**
 * GET /api/runs?source=<filename> — list runs that used this source sample file.
 * Returns most-recent first. Omit ?source to list all runs (capped at 100).
 */
export async function GET(req: NextRequest) {
  const source = req.nextUrl.searchParams.get("source");
  const supa = supabaseAdmin();

  let query = supa
    .from("runs")
    .select("id,status,topic,difficulty,mcq_type,count,quality,started_at,finished_at,error_message,sample_file_ids")
    .order("started_at", { ascending: false })
    .limit(100);

  if (source) {
    // sample_file_ids is jsonb; the @> operator checks containment.
    query = query.contains("sample_file_ids", [source]);
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    count: data?.length ?? 0,
    runs: (data ?? []).map((r) => ({
      id: r.id,
      status: r.status,
      topic: r.topic,
      difficulty: r.difficulty,
      mcq_type: r.mcq_type,
      count: r.count,
      quality: r.quality,
      started_at: r.started_at,
      finished_at: r.finished_at,
      error_message: r.error_message,
      sample_file_ids: r.sample_file_ids,
    })),
  });
}
