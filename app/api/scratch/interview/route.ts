import { NextRequest, NextResponse } from "next/server";
import { llm, extractJson } from "@/lib/ai/llm";
import { env } from "@/lib/env";
import { getUserTeam } from "@/lib/server/team";
import { INTERVIEW_SYSTEM, buildInterviewUser, sanitizeBrief } from "@/lib/ai/scratch";
import type { ScratchChatMsg, ScratchDoc, ScratchInterviewReply } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * One turn of the Create-from-scratch interview chat. Stateless: the client
 * sends the whole transcript (plus any attached-document digests) each turn;
 * the model either asks the next question or returns the finished brief.
 *
 * JSON: { messages: ScratchChatMsg[], docs: ScratchDoc[] } → ScratchInterviewReply
 */

const MAX_TURNS = 60;
const MAX_MSG_CHARS = 4_000;
const MAX_DOCS = 4;

export async function POST(req: NextRequest) {
  const { team } = await getUserTeam(req);
  if (!team) return NextResponse.json({ error: "not authenticated" }, { status: 401 });

  let body: { messages?: ScratchChatMsg[]; docs?: ScratchDoc[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const messages: ScratchChatMsg[] = (Array.isArray(body.messages) ? body.messages : [])
    .filter((m) => (m?.role === "user" || m?.role === "assistant") && typeof m?.text === "string")
    .slice(-MAX_TURNS)
    .map((m) => ({ role: m.role, text: m.text.slice(0, MAX_MSG_CHARS) }));
  const docs: ScratchDoc[] = (Array.isArray(body.docs) ? body.docs : [])
    .filter((d) => typeof d?.name === "string" && typeof d?.digest === "string")
    .slice(0, MAX_DOCS)
    .map((d) => ({ name: d.name.slice(0, 200), digest: d.digest.slice(0, 8_000) }));

  try {
    const reply = await runTurn(messages, docs);
    return NextResponse.json(reply);
  } catch (e) {
    return NextResponse.json(
      { error: `interview failed: ${e instanceof Error ? e.message : String(e)}` },
      { status: 502 },
    );
  }
}

async function runTurn(messages: ScratchChatMsg[], docs: ScratchDoc[]): Promise<ScratchInterviewReply> {
  const res = await llm().complete({
    model: env.modelFor("balanced"),
    maxTokens: 1600,
    system: INTERVIEW_SYSTEM,
    cacheSystem: true,
    messages: [{ role: "user", content: buildInterviewUser(messages, docs) }],
  });
  const parsed = JSON.parse(extractJson(res.text)) as Record<string, unknown>;

  if (parsed.action === "ready") {
    const brief = sanitizeBrief(parsed.brief);
    const summary = String(parsed.summary ?? "").trim() || `I'll build ${brief.count} ${brief.difficulty} questions on ${brief.topic}.`;
    return { action: "ready", brief, summary };
  }

  // Batch of follow-up questions (back-compat: a legacy single `question` is
  // wrapped into a one-element batch).
  const rawQs: unknown[] = Array.isArray(parsed.questions)
    ? parsed.questions
    : parsed.question
      ? [{ question: parsed.question, quick_replies: parsed.quick_replies, multi: parsed.multi }]
      : [];
  const questions = rawQs
    .map((raw) => {
      const q = (raw ?? {}) as Record<string, unknown>;
      const question = String(q.question ?? "").trim();
      if (!question) return null;
      const quick = (Array.isArray(q.quick_replies) ? q.quick_replies : [])
        .map((x) => String(x).trim())
        .filter(Boolean)
        .slice(0, 6);
      return {
        question,
        quick_replies: quick.length ? quick : undefined,
        multi: q.multi === true || undefined,
      };
    })
    .filter((q): q is NonNullable<typeof q> => q !== null)
    .slice(0, 4);
  if (questions.length === 0) throw new Error("model returned neither questions nor a brief");
  return { action: "ask", questions };
}
