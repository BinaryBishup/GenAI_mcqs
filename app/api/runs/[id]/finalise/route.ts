import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";

/**
 * POST /api/runs/[id]/finalise — mark a run as finalised, visible to the whole
 * team (previously this lived only in the reviewer's localStorage).
 * Body: { by?: string } — display name of whoever finalised.
 * Idempotent: re-finalising keeps the original timestamp.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const by = String((await req.json().catch(() => ({})))?.by ?? "").trim() || null;
  const supa = supabaseAdmin();

  const { data: existing, error: readErr } = await supa
    .from("runs")
    .select("id,finalised_at")
    .eq("id", id)
    .single();
  if (readErr || !existing) return NextResponse.json({ error: "run not found" }, { status: 404 });
  if (existing.finalised_at) return NextResponse.json({ ok: true, finalised_at: existing.finalised_at });

  const finalised_at = new Date().toISOString();
  const { error } = await supa
    .from("runs")
    .update({ finalised_at, finalised_by: by })
    .eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, finalised_at });
}
