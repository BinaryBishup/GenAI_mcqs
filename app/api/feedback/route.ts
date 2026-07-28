import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { getUserTeam } from "@/lib/team";

export const runtime = "nodejs";

const CATEGORIES = ["general", "quality", "bug", "feature"] as const;

/**
 * POST /api/feedback { category, rating?, message, page? } — store one piece
 * of feedback stamped with the caller's team and name.
 * GET /api/feedback — this team's feedback, newest first.
 */
export async function POST(req: NextRequest) {
  const { team, userId, name } = await getUserTeam(req);
  if (!team) return NextResponse.json({ error: "not authenticated" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as {
    category?: string;
    rating?: number;
    message?: string;
    page?: string;
  };

  const message = (body.message ?? "").trim();
  if (!message) return NextResponse.json({ error: "message is required" }, { status: 400 });

  const category = CATEGORIES.includes(body.category as (typeof CATEGORIES)[number]) ? body.category : "general";
  const rating = typeof body.rating === "number" && body.rating >= 1 && body.rating <= 5 ? Math.round(body.rating) : null;

  const { data, error } = await supabaseAdmin()
    .from("feedback")
    .insert({
      team,
      user_id: userId,
      user_name: name,
      category,
      rating,
      message: message.slice(0, 4000),
      page: (body.page ?? "").slice(0, 200) || null,
    })
    .select("id,created_at,team,user_name,category,rating,message")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ feedback: data });
}

export async function GET(req: NextRequest) {
  const { team } = await getUserTeam(req);
  if (!team) return NextResponse.json({ error: "not authenticated" }, { status: 401 });

  const { data, error } = await supabaseAdmin()
    .from("feedback")
    .select("id,created_at,user_name,category,rating,message")
    .eq("team", team)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ feedback: data ?? [] });
}
