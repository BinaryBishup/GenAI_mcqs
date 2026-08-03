import { NextRequest, NextResponse } from "next/server";
import { database } from "@/lib/server/db";

export const runtime = "nodejs";

/**
 * Stored progress events for a run, in order. Lets the Generations page replay
 * the live "process" (Timeline) when reopening a run — including one that is
 * still generating in the background — instead of only showing finished cards.
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const db = database();

  const { data, error } = await db
    .from("run_events")
    .select("type,data,ts")
    .eq("run_id", id)
    .order("ts", { ascending: true })
    .order("id", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    run_id: id,
    events: (data ?? []).map((e) => ({ type: e.type, data: e.data })),
  });
}
