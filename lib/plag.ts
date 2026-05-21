import * as fuzz from "fuzzball";
import { supabaseAdmin } from "./supabase";
import { env } from "./env";
import { normalizeText } from "./utils";
import { tavilySearch, TavilyResult } from "./tavily";
import type { MCQ, PlagMatch, PlagVerdict } from "./types";

/**
 * Plag check — exact / near-exact match.
 *
 * Two signals run in parallel:
 *   1. Local corpus — Postgres `match_plag_trgm()` (pg_trgm prefilter) then
 *      `fuzzball` token_set_ratio re-rank. Catches stuff we've scraped.
 *   2. Web — Tavily search on the question text; each hit's title+content is
 *      compared against the question with token_set_ratio. Catches stuff
 *      that's on the public web but not in our scraped corpus.
 *
 * If either signal scores ≥ PLAG_FUZZ_THRESHOLD (default 0.85), the MCQ is
 * flagged. Tavily is skipped when TAVILY_API_KEY is missing.
 */
export async function checkPlag(mcq: MCQ): Promise<PlagVerdict> {
  const queryNorm = normalizeText(mcq.question);
  const language = mcq.snippet?.language ?? null;
  const threshold = env.plagFuzzThreshold();

  const [corpusMatches, webMatches] = await Promise.all([
    checkCorpus(queryNorm, language),
    env.tavilyKey() ? checkWeb(mcq.question, queryNorm) : Promise.resolve([] as PlagMatch[]),
  ]);

  const corpusFlagged = corpusMatches[0]?.similarity >= threshold;
  const webFlagged = webMatches[0]?.similarity >= threshold;
  const flagged = corpusFlagged || webFlagged;

  const usedWeb = env.tavilyKey() !== null;
  const method: PlagVerdict["method"] =
    usedWeb && corpusMatches.length > 0 ? "corpus+web" :
    usedWeb ? "web" : "corpus";

  // Merge + de-dupe by URL, keep highest similarity.
  const byUrl = new Map<string, PlagMatch>();
  for (const m of [...corpusMatches, ...webMatches]) {
    const prev = byUrl.get(m.url);
    if (!prev || m.similarity > prev.similarity) byUrl.set(m.url, m);
  }
  const matches = [...byUrl.values()].sort((a, b) => b.similarity - a.similarity).slice(0, 5);

  return { verdict: flagged ? "flagged" : "unique", matches, method };
}

async function checkCorpus(queryNorm: string, language: string | null): Promise<PlagMatch[]> {
  const supa = supabaseAdmin();
  const { data, error } = await supa.rpc("match_plag_trgm", {
    query_text: queryNorm,
    match_count: 10,
    filter_language: language,
  });

  if (error) {
    console.warn("match_plag_trgm rpc error:", error.message);
    return [];
  }

  type Row = { id: number; source: string; url: string; question: string; similarity: number };
  const rows = (data ?? []) as Row[];

  const ranked: PlagMatch[] = rows.map((r) => ({
    source: r.source,
    url: r.url,
    question: r.question,
    similarity: fuzz.token_set_ratio(queryNorm, normalizeText(r.question)) / 100,
  }));
  ranked.sort((a, b) => b.similarity - a.similarity);
  return ranked;
}

async function checkWeb(rawQuestion: string, queryNorm: string): Promise<PlagMatch[]> {
  let results: TavilyResult[] = [];
  try {
    // Quoted question makes Tavily prefer exact-phrase matches.
    results = await tavilySearch(`"${rawQuestion.slice(0, 200)}"`, 5);
  } catch (e) {
    console.warn("tavily error:", (e as Error).message);
    return [];
  }

  // For each hit, score (title + content) vs the question.
  const ranked: PlagMatch[] = results.map((r) => {
    const haystack = normalizeText(`${r.title ?? ""} ${r.content ?? ""}`);
    const score = haystack ? fuzz.token_set_ratio(queryNorm, haystack) / 100 : 0;
    return {
      source: "tavily",
      url: r.url,
      question: (r.content ?? r.title ?? "").slice(0, 200),
      similarity: score,
    };
  });
  ranked.sort((a, b) => b.similarity - a.similarity);
  return ranked;
}
