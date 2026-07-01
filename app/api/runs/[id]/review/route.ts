import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { getUserTeam } from "@/lib/team";

export const runtime = "nodejs";

const VALID = new Set(["pending", "approved", "rejected", "duplicate"]);

/**
 * POST /api/runs/[id]/review  { index, status }
 * Persist one reviewer's per-question decision (approved/rejected/duplicate/
 * pending). Team-scoped: you can only review your own team's run.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const { team, name } = await getUserTeam(req);
  if (!team) return NextResponse.json({ error: "not authenticated" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const index = Number(body?.index);
  const status = String(body?.status ?? "");
  if (!Number.isInteger(index) || !VALID.has(status)) {
    return NextResponse.json({ error: "index and a valid status are required" }, { status: 400 });
  }

  const supa = supabaseAdmin();
  const { data: run } = await supa.from("runs").select("team").eq("id", id).single();
  if (!run) return NextResponse.json({ error: "run not found" }, { status: 404 });
  if (run.team && run.team !== team) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { error } = await supa
    .from("mcqs")
    .update({ review_status: status, reviewed_by: name, reviewed_at: new Date().toISOString() })
    .eq("run_id", id)
    .eq("index", index);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
