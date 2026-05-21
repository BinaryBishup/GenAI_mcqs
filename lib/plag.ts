import * as fuzz from "fuzzball";
import { supabaseAdmin } from "./supabase";
import { env } from "./env";
import { normalizeText } from "./utils";
import type { MCQ, PlagMatch, PlagVerdict } from "./types";

/**
 * Plag check — exact / near-exact match against the local scraped corpus.
 *
 * Two-stage pipeline:
 *   1. Postgres `match_plag_trgm()` — trigram-similarity prefilter using the
 *      existing GIN(question_norm gin_trgm_ops) index. Cheap, returns top-K.
 *   2. fuzzball `token_set_ratio` — precise re-ranking on the candidates.
 *      Token-set ratio is tolerant of word reordering but not of conceptual
 *      paraphrasing, which is exactly what we want.
 *
 * Threshold: PLAG_FUZZ_THRESHOLD (default 0.85). At 0.85 the check accepts
 * minor edits ("What is" → "Which is", swapped identifier names) and rejects
 * near-verbatim copies.
 */
export async function checkPlag(mcq: MCQ): Promise<PlagVerdict> {
  const supa = supabaseAdmin();
  const queryNorm = normalizeText(mcq.question);
  const language = mcq.snippet?.language ?? null;

  const { data, error } = await supa.rpc("match_plag_trgm", {
    query_text: queryNorm,
    match_count: 10,
    filter_language: language,
  });

  if (error) {
    console.warn("match_plag_trgm rpc error:", error.message);
    return { verdict: "unique", matches: [], method: "corpus" };
  }

  type Row = { id: number; source: string; url: string; question: string; similarity: number };
  const rows = (data ?? []) as Row[];
  if (rows.length === 0) {
    return { verdict: "unique", matches: [], method: "corpus" };
  }

  // Re-rank with token_set_ratio so word reorderings don't fool us.
  const ranked = rows.map((r) => ({
    source: r.source,
    url: r.url,
    question: r.question,
    similarity: fuzz.token_set_ratio(queryNorm, normalizeText(r.question)) / 100,
  }));
  ranked.sort((a, b) => b.similarity - a.similarity);

  const threshold = env.plagFuzzThreshold();
  const flagged = ranked[0].similarity >= threshold;

  return {
    verdict: flagged ? "flagged" : "unique",
    matches: ranked.slice(0, 5) as PlagMatch[],
    method: "corpus",
  };
}
