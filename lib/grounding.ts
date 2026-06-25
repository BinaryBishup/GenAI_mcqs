import { tavilyGround } from "./tavily";
import type { Difficulty, MCQType } from "./types";

export interface GroundingPack {
  /** True if we actually retrieved usable reference material. */
  ok: boolean;
  /** Source URLs used, for provenance/logging. */
  sources: string[];
  /** The prompt-ready reference block (empty string when !ok). */
  block: string;
}

const EMPTY: GroundingPack = { ok: false, sources: [], block: "" };

/** Hard cap on injected reference text so the prompt stays cache-friendly. */
const MAX_BLOCK_CHARS = 6000;
const MAX_SNIPPET_CHARS = 700;

/**
 * Build a factual-grounding reference pack for a topic via one Tavily search.
 *
 * The pack is injected into the generation prompt and the model is instructed
 * to only assert facts supported by it. This is the main lever against
 * fact-hallucination in conceptual ("general") MCQs, where there is no code to
 * execute and no sample answer to trust.
 *
 * Cheap by design: ONE advanced search per run (not per question). Returns an
 * empty (ok:false) pack — never throws — when grounding is off, the key is
 * missing, or the search comes back empty; the caller then generates ungrounded.
 */
export async function buildGroundingPack(args: {
  topic: string;
  mcqType: MCQType;
  difficulty: Difficulty;
  /** Extra focus terms (e.g. the user's additional instructions). */
  focus?: string;
}): Promise<GroundingPack> {
  const topic = args.topic?.trim();
  if (!topic) return EMPTY;

  // A factual query, not a "make me questions" query — we want reference prose.
  const lens = args.mcqType === "code"
    ? "key concepts, correct behaviour, common mistakes and gotchas"
    : "key facts, definitions, correct statements and common misconceptions";
  const query = `${topic} — ${lens}${args.focus ? ` (${args.focus.slice(0, 120)})` : ""}`;

  const { answer, results } = await tavilyGround(query, 6);
  if (!answer && results.length === 0) return EMPTY;

  const lines: string[] = ["<reference_material>"];
  if (answer) {
    lines.push("summary:");
    lines.push(answer.trim().slice(0, 1500));
    lines.push("");
  }
  const sources: string[] = [];
  let used = lines.join("\n").length;
  for (const r of results) {
    const snippet = (r.content ?? "").trim();
    if (!snippet) continue;
    const entry = `- (${r.url}) ${snippet.slice(0, MAX_SNIPPET_CHARS)}`;
    if (used + entry.length > MAX_BLOCK_CHARS) break;
    lines.push(entry);
    sources.push(r.url);
    used += entry.length;
  }
  lines.push("</reference_material>");

  if (sources.length === 0 && !answer) return EMPTY;
  return { ok: true, sources, block: lines.join("\n") };
}
