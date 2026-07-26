import { NextRequest, after } from "next/server";
import { SSEStream } from "@/lib/sse";
import { runWorkflow } from "@/lib/runner";
import { getUserTeam } from "@/lib/team";
import { supabaseAdmin } from "@/lib/supabase";
import { DAILY_QUESTION_LIMIT } from "@/lib/limits";
import type { GenerateRequest } from "@/lib/types";

export const runtime = "nodejs";
// Generation + plag-check + verify for large counts can run several minutes.
// 800s is the Vercel Pro ceiling; on Hobby this is clamped to the plan limit.
export const maxDuration = 800;
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  let body: GenerateRequest;
  try {
    body = (await req.json()) as GenerateRequest;
  } catch {
    return new Response(JSON.stringify({ error: "invalid JSON" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!body.topic?.trim()) {
    return new Response(JSON.stringify({ error: "topic is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Scope the run to the signed-in user's team and stamp who started it
  // (server-trusted, not client-set).
  const { team, userId, name } = await getUserTeam(req);
  if (!team) {
    return new Response(JSON.stringify({ error: "not authenticated" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  body.team = team;
  body.created_by = userId;
  body.created_by_name = name;

  // Enforce the team's daily generation budget before spending tokens.
  // Errored runs are excluded — they fail before consuming anything meaningful.
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const { data: todays, error: usageErr } = await supabaseAdmin()
    .from("runs")
    .select("count")
    .eq("team", team)
    .neq("status", "error")
    .gte("started_at", dayStart.toISOString());
  if (!usageErr) {
    const used = (todays ?? []).reduce((t, r) => t + (r.count ?? 0), 0);
    const requested = Math.max(1, body.count ?? 0);
    if (used + requested > DAILY_QUESTION_LIMIT) {
      return new Response(
        JSON.stringify({
          error: `Daily limit reached: your team has generated ${used} of ${DAILY_QUESTION_LIMIT} questions today. Try again tomorrow or reduce the question count.`,
        }),
        { status: 429, headers: { "Content-Type": "application/json" } },
      );
    }
  }

  const stream = new SSEStream();

  // Kick off the workflow without awaiting so we can return the stream immediately.
  // SSE events are pushed via stream.send(...) as the workflow progresses.
  const workflow = (async () => {
    try {
      await runWorkflow(body, (evt) => stream.send(evt.type, evt.data));
    } catch (err) {
      stream.send("error", {
        phase: "workflow",
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      stream.close();
    }
  })();

  // Keep the serverless function alive until the workflow finishes even if the
  // client disconnects (closed tab / navigated away). Without this, Vercel can
  // freeze the function once the response stream is cancelled, leaving the run
  // stuck at "generating". The workflow persists everything to Supabase as it
  // goes, so the user can reopen the run later and see it complete.
  after(workflow);

  return stream.toResponse();
}
