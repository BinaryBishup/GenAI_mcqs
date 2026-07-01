import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { getUserTeam } from "@/lib/team";

export const runtime = "nodejs";

/**
 * POST /api/runs/[id]/publish  { undo?: boolean }
 * Publish a finalised run into the shared Admin inventory (or clear it with
 * undo:true). Team-scoped for the write; the Admin inventory itself is shared
 * across teams (see /api/banks/admin). Must be finalised before publishing.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const { team, name } = await getUserTeam(req);
  if (!team) return NextResponse.json({ error: "not authenticated" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const undo = !!body?.undo;

  const supa = supabaseAdmin();
  const { data: run } = await supa.from("runs").select("team,finalised_at").eq("id", id).single();
  if (!run) return NextResponse.json({ error: "run not found" }, { status: 404 });
  if (run.team && run.team !== team) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!undo && !run.finalised_at) {
    return NextResponse.json({ error: "finalise the set before publishing" }, { status: 400 });
  }

  const patch = undo
    ? { published_at: null, published_by: null }
    : { published_at: new Date().toISOString(), published_by: name };
  const { error } = await supa.from("runs").update(patch).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
