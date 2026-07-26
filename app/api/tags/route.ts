import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { getUserTeam } from "@/lib/team";

export const runtime = "nodejs";

/**
 * GET /api/tags — list this team's tags, each with its member items embedded.
 * POST /api/tags { name, color? } — create a tag for the active team.
 * Tags are shared across everyone who can view the team.
 */
export async function GET(req: NextRequest) {
  const supa = supabaseAdmin();
  const { team } = await getUserTeam(req);
  if (!team) return NextResponse.json({ error: "not authenticated" }, { status: 401 });

  const { data: tags, error } = await supa
    .from("tags")
    .select("id,name,color,created_at")
    .eq("team", team)
    .order("created_at", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const ids = (tags ?? []).map((t) => t.id);
  const itemsByTag = new Map<string, { item_type: string; item_id: string }[]>();
  if (ids.length) {
    const { data: items, error: iErr } = await supa
      .from("tag_items")
      .select("tag_id,item_type,item_id")
      .in("tag_id", ids);
    if (iErr) return NextResponse.json({ error: iErr.message }, { status: 500 });
    for (const it of items ?? []) {
      const arr = itemsByTag.get(it.tag_id) ?? [];
      arr.push({ item_type: it.item_type, item_id: it.item_id });
      itemsByTag.set(it.tag_id, arr);
    }
  }

  return NextResponse.json({
    tags: (tags ?? []).map((t) => ({
      id: t.id,
      name: t.name,
      color: t.color,
      items: itemsByTag.get(t.id) ?? [],
    })),
  });
}

export async function POST(req: NextRequest) {
  const supa = supabaseAdmin();
  const { team, userId } = await getUserTeam(req);
  if (!team) return NextResponse.json({ error: "not authenticated" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const color = typeof body.color === "string" && body.color ? body.color : "#7AB52C";
  if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });
  if (name.length > 60) return NextResponse.json({ error: "name too long" }, { status: 400 });

  const { data, error } = await supa
    .from("tags")
    .insert({ team, name, color, created_by: userId })
    .select("id,name,color")
    .single();
  if (error) {
    // 23505 = unique_violation (a tag with this name already exists for the team)
    if (error.code === "23505") return NextResponse.json({ error: "A tag with that name already exists." }, { status: 409 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ tag: { id: data.id, name: data.name, color: data.color, items: [] } });
}
