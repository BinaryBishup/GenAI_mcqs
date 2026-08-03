import { NextRequest, NextResponse } from "next/server";
import { database } from "@/lib/server/db";

export const runtime = "nodejs";

const STATUSES = new Set(["pending", "approved", "rejected", "duplicate"]);

/**
 * POST /api/runs/[id]/review — persist one question's review decision so it
 * survives refreshes and is visible to teammates.
 * Body: { index: number, status: "pending"|"approved"|"rejected"|"duplicate",
 *         reason?: string, by?: string }
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => null);
  const index = Number(body?.index);
  const status = String(body?.status ?? "");
  if (!Number.isInteger(index) || index < 0 || !STATUSES.has(status)) {
    return NextResponse.json({ error: "expected { index, status }" }, { status: 400 });
  }
  const reason = String(body?.reason ?? "").trim() || null;
  const by = String(body?.by ?? "").trim() || null;

  const { error } = await database()
    .from("mcqs")
    .update({
      review_status: status,
      review_reason: reason,
      reviewed_by: by,
      reviewed_at: new Date().toISOString(),
    })
    .eq("run_id", id)
    .eq("index", index);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
