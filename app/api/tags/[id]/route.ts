import { NextRequest, NextResponse } from "next/server";
import { database } from "@/lib/server/db";
import { getUserTeam } from "@/lib/server/team";

export const runtime = "nodejs";

/** DELETE /api/tags/:id — remove a tag (its items cascade). Team-scoped. */
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const db = database();
  const { team } = await getUserTeam(req);
  if (!team) return NextResponse.json({ error: "not authenticated" }, { status: 401 });

  // Scope the delete to the active team so a tag can't be removed cross-team.
  const { error } = await db.from("tags").delete().eq("id", id).eq("team", team);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
