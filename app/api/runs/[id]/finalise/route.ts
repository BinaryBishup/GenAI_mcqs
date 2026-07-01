import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { getUserTeam } from "@/lib/team";

export const runtime = "nodejs";

/**
 * POST /api/runs/[id]/finalise  { undo?: boolean }
 * Mark a reviewed run as finalised (or clear it with undo:true). Team-scoped.
 * "Finalise" is a lifecycle flag on the run — the approved questions in the run
 * become the finalised bank; no separate table.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const { team, name } = await getUserTeam(req);
  if (!team) return NextResponse.json({ error: "not authenticated" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const undo = !!body?.undo;

  const supa = supabaseAdmin();
  const { data: run } = await supa.from("runs").select("team,status").eq("id", id).single();
  if (!run) return NextResponse.json({ error: "run not found" }, { status: 404 });
  if (run.team && run.team !== team) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const patch = undo
    ? { finalised_at: null, finalised_by: null, published_at: null, published_by: null }
    : { finalised_at: new Date().toISOString(), finalised_by: name };
  const { error } = await supa.from("runs").update(patch).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
