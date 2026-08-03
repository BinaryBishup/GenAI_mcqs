import { NextRequest, NextResponse } from "next/server";
import { database } from "@/lib/server/db";
import { env } from "@/lib/env";
import { generateDiagram } from "@/lib/ai/diagram";
import { getUserTeam } from "@/lib/server/team";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Regenerate / revise the inline SVG diagram for one MCQ.
 * POST { run_id, index, instruction? } → { image_svg }.
 * With an instruction it revises the existing diagram (or draws a new one to
 * that spec); without one it redraws for clarity.
 */
export async function POST(req: NextRequest) {
  const { team } = await getUserTeam(req);
  if (!team) return NextResponse.json({ error: "not authenticated" }, { status: 401 });

  let body: { run_id?: string; index?: number; instruction?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const { run_id, index, instruction } = body;
  if (!run_id || typeof index !== "number") {
    return NextResponse.json({ error: "run_id and index are required" }, { status: 400 });
  }

  const db = database();
  const { data: mcq, error } = await db
    .from("mcqs")
    .select("question,options,difficulty,image_svg")
    .eq("run_id", run_id)
    .eq("index", index)
    .single();
  if (error || !mcq) return NextResponse.json({ error: "question not found" }, { status: 404 });

  const svg = await generateDiagram({
    question: mcq.question,
    options: (mcq.options as string[]) ?? [],
    difficulty: (mcq.difficulty as string) ?? "medium",
    model: env.modelFor("balanced"),
    instruction:
      instruction?.trim() ||
      (mcq.image_svg ? "Redraw for maximum clarity: ensure NO text is hidden, clipped, or overlapping any shape or line." : "Add a clear, legible diagram for this question."),
    existingSvg: (mcq.image_svg as string) ?? undefined,
  });
  if (!svg) return NextResponse.json({ error: "could not generate a diagram for this question" }, { status: 422 });

  await db.from("mcqs").update({ image_svg: svg }).eq("run_id", run_id).eq("index", index);
  return NextResponse.json({ image_svg: svg });
}
