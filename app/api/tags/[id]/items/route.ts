import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { getUserTeam } from "@/lib/team";

export const runtime = "nodejs";

/** Confirm the tag exists and belongs to the caller's active team. */
async function tagInTeam(supa: ReturnType<typeof supabaseAdmin>, id: string, team: string) {
  const { data } = await supa.from("tags").select("id").eq("id", id).eq("team", team).maybeSingle();
  return !!data;
}

function parseItem(body: Record<string, unknown>) {
  const item_type = body.item_type === "run" || body.item_type === "sample" ? body.item_type : null;
  const item_id = typeof body.item_id === "string" ? body.item_id : "";
  return item_type && item_id ? { item_type, item_id } : null;
}

/** POST /api/tags/:id/items { item_type, item_id } — add a run or bank to the tag. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const supa = supabaseAdmin();
  const { team } = await getUserTeam(req);
  if (!team) return NextResponse.json({ error: "not authenticated" }, { status: 401 });

  const item = parseItem(await req.json().catch(() => ({})));
  if (!item) return NextResponse.json({ error: "item_type and item_id required" }, { status: 400 });
  if (!(await tagInTeam(supa, id, team))) return NextResponse.json({ error: "tag not found" }, { status: 404 });

  // Idempotent: ignore a duplicate membership row.
  const { error } = await supa
    .from("tag_items")
    .upsert({ tag_id: id, ...item }, { onConflict: "tag_id,item_type,item_id", ignoreDuplicates: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

/** DELETE /api/tags/:id/items { item_type, item_id } — remove a member from the tag. */
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const supa = supabaseAdmin();
  const { team } = await getUserTeam(req);
  if (!team) return NextResponse.json({ error: "not authenticated" }, { status: 401 });

  const item = parseItem(await req.json().catch(() => ({})));
  if (!item) return NextResponse.json({ error: "item_type and item_id required" }, { status: 400 });
  if (!(await tagInTeam(supa, id, team))) return NextResponse.json({ error: "tag not found" }, { status: 404 });

  const { error } = await supa
    .from("tag_items")
    .delete()
    .eq("tag_id", id)
    .eq("item_type", item.item_type)
    .eq("item_id", item.item_id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
