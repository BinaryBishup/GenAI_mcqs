import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { getUserTeam } from "@/lib/team";

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

/**
 * PATCH /api/samples/[filename] { name } — rename a Local bank. The filename is
 * the bank's key everywhere, so tag memberships and past runs that reference it
 * are updated to the new name too. Scoped to the caller's team.
 */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ filename: string }> }) {
  const { filename } = await ctx.params;
  const decoded = decodeURIComponent(filename);

  const supa = supabaseAdmin();
  const { team } = await getUserTeam(req);
  if (!team) return NextResponse.json({ error: "not authenticated" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const newName = typeof body.name === "string" ? body.name.trim() : "";
  if (!newName) return NextResponse.json({ error: "name required" }, { status: 400 });
  if (newName.length > 120) return NextResponse.json({ error: "name too long" }, { status: 400 });
  if (newName === decoded) return NextResponse.json({ filename: decoded });

  const { data: existing, error: exErr } = await supa
    .from("samples").select("id").eq("source_file", decoded).eq("team", team).limit(1);
  if (exErr) return NextResponse.json({ error: exErr.message }, { status: 500 });
  if (!existing?.length) return NextResponse.json({ error: "bank not found in your team" }, { status: 404 });

  const { data: clash } = await supa
    .from("samples").select("id").eq("source_file", newName).eq("team", team).limit(1);
  if (clash?.length) return NextResponse.json({ error: "A bank with that name already exists." }, { status: 409 });

  const { error: upErr } = await supa
    .from("samples").update({ source_file: newName }).eq("source_file", decoded).eq("team", team);
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

  // Keep tag memberships pointing at the renamed bank.
  await supa.from("tag_items").update({ item_id: newName }).eq("item_type", "sample").eq("item_id", decoded);

  // Past runs record which banks seeded them (jsonb array of filenames).
  const { data: refRuns } = await supa
    .from("runs").select("id,sample_file_ids").contains("sample_file_ids", [decoded]);
  for (const r of refRuns ?? []) {
    const updated = ((r.sample_file_ids as string[]) ?? []).map((f) => (f === decoded ? newName : f));
    await supa.from("runs").update({ sample_file_ids: updated }).eq("id", r.id);
  }

  return NextResponse.json({ filename: newName });
}
