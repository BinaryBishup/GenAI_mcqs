import { NextRequest, NextResponse } from "next/server";
import { llm, extractJson } from "@/lib/ai/llm";
import { env } from "@/lib/env";
import { getUserTeam } from "@/lib/server/team";
import { SAMPLES_SYSTEM, buildSamplesPrompt, sanitizeBrief } from "@/lib/ai/scratch";
import type { CodeSnippet, Language, ScratchVariant } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Generate 4 sample questions in distinct style varieties from a finished
 * interview brief, for the author to pick favourites from before the full run.
 *
 * JSON: { brief: ScratchBrief, exclude?: string[] } → { variants: ScratchVariant[] }
 * `exclude` carries previously-shown sample stems when the author asks for
 * different varieties.
 */

const LANGS: Language[] = ["python", "java", "cpp", "c", "csharp", "javascript", "html", "css"];

export async function POST(req: NextRequest) {
  const { team } = await getUserTeam(req);
  if (!team) return NextResponse.json({ error: "not authenticated" }, { status: 401 });

  let body: { brief?: unknown; exclude?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  let brief;
  try {
    brief = sanitizeBrief(body.brief);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "invalid brief" }, { status: 400 });
  }
  const exclude = (Array.isArray(body.exclude) ? body.exclude : [])
    .map((q) => String(q).trim())
    .filter(Boolean)
    .slice(0, 12);

  try {
    const variants = await generateVariants(brief, team, exclude);
    return NextResponse.json({ variants });
  } catch (e) {
    return NextResponse.json(
      { error: `sample generation failed: ${e instanceof Error ? e.message : String(e)}` },
      { status: 502 },
    );
  }
}

async function generateVariants(
  brief: ReturnType<typeof sanitizeBrief>,
  team: string,
  exclude: string[],
): Promise<ScratchVariant[]> {
  const msg = await llm().complete({
    model: env.modelFor("balanced"),
    maxTokens: 6000,
    system: SAMPLES_SYSTEM,
    messages: [{ role: "user", content: buildSamplesPrompt(brief, team, exclude) }],
  });
  const parsed = JSON.parse(extractJson(msg.text));
  if (!Array.isArray(parsed)) throw new Error("model did not return a JSON array");

  const variants = (parsed as unknown[]).map(normalizeVariant).filter((v): v is ScratchVariant => v !== null);
  if (variants.length < 2) throw new Error("model returned too few valid samples");
  return variants.slice(0, 4);
}

function normalizeVariant(raw: unknown): ScratchVariant | null {
  const v = (raw ?? {}) as Record<string, unknown>;
  const m = (v.mcq ?? {}) as Record<string, unknown>;
  const question = String(m.question ?? "").trim();
  const options = (Array.isArray(m.options) ? m.options : []).map(String);
  if (!question || options.length !== 4) return null;
  const correct = Math.max(0, Math.min(3, Math.round(Number(m.correct_index ?? 0)) || 0));
  const rawSnip = m.snippet as { language?: unknown; code?: unknown } | undefined;
  const snippet: CodeSnippet | null =
    rawSnip && typeof rawSnip.code === "string" && rawSnip.code.trim()
      ? {
          language: LANGS.includes(rawSnip.language as Language) ? (rawSnip.language as Language) : "python",
          code: rawSnip.code,
        }
      : null;
  return {
    style_label: String(v.style_label ?? "Variety").trim().slice(0, 60) || "Variety",
    style_summary: String(v.style_summary ?? "").trim().slice(0, 300),
    kind: v.kind === "analysis" ? "analysis" : "application",
    mcq: {
      question,
      options,
      correct_index: correct,
      explanation: typeof m.explanation === "string" ? m.explanation : null,
      snippet,
    },
  };
}
