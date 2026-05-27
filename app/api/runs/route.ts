import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";

/**
 * GET /api/runs?source=<filename> — list runs that used this source sample file.
 * Returns most-recent first. Omit ?source to list all runs (capped at 100).
 */
/**
 * Runs stuck in a non-terminal state longer than this are considered dead —
 * the function was killed (Vercel time limit), the dev server restarted, or the
 * process crashed before the workflow could flip the row to done/error. The
 * window is comfortably longer than any single run can take (maxDuration ceiling
 * is ~13min), so we never mark a genuinely-live run as stale.
 */
const STALE_MS = 20 * 60 * 1000;
const NON_TERMINAL = ["pending", "generating", "plagchecking", "revamping", "verifying"];

/** Mark abandoned non-terminal runs as errored so the list reflects reality. */
async function sweepStaleRuns(supa: ReturnType<typeof supabaseAdmin>) {
  const cutoff = new Date(Date.now() - STALE_MS).toISOString();
  await supa
    .from("runs")
    .update({
      status: "error",
      error_message: "Run was interrupted or timed out before finishing (marked stale).",
      finished_at: new Date().toISOString(),
    })
    .in("status", NON_TERMINAL)
    .lt("started_at", cutoff);
}

export async function GET(req: NextRequest) {
  const source = req.nextUrl.searchParams.get("source");
  const supa = supabaseAdmin();

  await sweepStaleRuns(supa);

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
