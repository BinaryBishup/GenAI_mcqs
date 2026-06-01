import { NextRequest, NextResponse } from "next/server";
import { anthropic, extractJson } from "@/lib/anthropic";
import { env } from "@/lib/env";
import { buildModifyPrompt } from "@/lib/prompts";
import type { Language, MCQ } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * AI-assisted edit of a single MCQ: given the question and a natural-language
 * instruction ("make the distractors harder", "fix the wording", "change the
 * scenario to healthcare"), return the modified MCQ. Does NOT persist — the
 * client persists via PATCH /api/mcqs (which also re-checks the answer).
 *
 * Body: { mcq: MCQ, instruction: string }
 * Returns: { mcq: MCQ }
 */
export async function POST(req: NextRequest) {
  let body: { mcq?: MCQ; instruction?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const { mcq, instruction } = body;
  if (!mcq || !instruction?.trim()) {
    return NextResponse.json({ error: "mcq and instruction are required" }, { status: 400 });
  }

  const prompt = buildModifyPrompt({
    mcq: {
      type: mcq.type,
      topic: mcq.topic,
      difficulty: mcq.difficulty,
      question: mcq.question,
      options: mcq.options,
      correct_index: mcq.correct_index,
      explanation: mcq.explanation ?? null,
      snippet: mcq.snippet ? { language: mcq.snippet.language, code: mcq.snippet.code } : null,
    },
    instruction,
  });

  try {
    const msg = await anthropic().messages.create({
      model: env.modelFor("balanced"),
      max_tokens: 2000,
      messages: [{ role: "user", content: prompt }],
    });
    const text = msg.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n");
    const obj = JSON.parse(extractJson(text));

    const options = Array.isArray(obj.options) ? obj.options.map(String).slice(0, 4) : mcq.options;
    while (options.length < 4) options.push("");
    const correct = Math.max(0, Math.min(3, Number(obj.correct_index ?? mcq.correct_index ?? 0)));

    const updated: MCQ = {
      ...mcq,
      type: obj.type === "code" ? "code" : obj.snippet?.code ? "code" : mcq.type,
      question: String(obj.question ?? mcq.question),
      options,
      correct_index: correct,
      explanation: obj.explanation ?? mcq.explanation ?? null,
      snippet: obj.snippet?.code
        ? { language: (obj.snippet.language ?? mcq.snippet?.language ?? "python") as Language, code: String(obj.snippet.code) }
        : mcq.snippet ?? null,
    };
    return NextResponse.json({ mcq: updated });
  } catch (e) {
    return NextResponse.json({ error: `modify failed: ${(e as Error).message}` }, { status: 500 });
  }
}
