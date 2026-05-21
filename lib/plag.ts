import { embed } from "./voyage";
import { exaSearch } from "./exa";
import { supabaseAdmin } from "./supabase";
import { env } from "./env";
import { normalizeText } from "./utils";
import type { MCQ, PlagMatch, PlagVerdict } from "./types";

/**
 * Hybrid plagiarism check:
 *   1. Embed the question (+ a code line if present) with Voyage.
 *   2. KNN in plag_corpus via pgvector cosine.
 *   3. If top similarity >= PLAG_COSINE_THRESHOLD → flagged.
 *   4. If similarity is in the "uncertain" band → Exa fallback.
 *   5. Otherwise → unique.
 */
export async function checkPlag(mcq: MCQ): Promise<PlagVerdict> {
  const queries = [normalizeText(mcq.question)];
  const codeLine = pickDistinctiveLine(mcq.snippet?.code);
  if (codeLine) queries.push(codeLine);

  const [vectors] = await Promise.all([embed(queries, { inputType: "query" })]);

  const language = mcq.snippet?.language ?? null;
  const allCorpusMatches: PlagMatch[] = [];

  for (const v of vectors) {
    const { data, error } = await supabaseAdmin().rpc("match_plag_corpus", {
      query_embedding: v as unknown as string,  // supabase-js serializes arrays as pgvector literals
      match_count: 5,
      filter_language: language,
    });
    if (error) {
      console.warn("match_plag_corpus rpc error:", error.message);
      continue;
    }
    for (const r of (data ?? []) as { id: number; source: string; url: string; question: string; similarity: number }[]) {
      allCorpusMatches.push({
        source: r.source,
        url: r.url,
        similarity: r.similarity,
        question: r.question,
      });
    }
  }

  // De-dupe by url, keep highest similarity.
  const byUrl = new Map<string, PlagMatch>();
  for (const m of allCorpusMatches) {
    const existing = byUrl.get(m.url);
    if (!existing || m.similarity > existing.similarity) byUrl.set(m.url, m);
  }
  const corpus = [...byUrl.values()].sort((a, b) => b.similarity - a.similarity);
  const top = corpus[0]?.similarity ?? 0;

  if (top >= env.plagThreshold()) {
    return { verdict: "flagged", matches: corpus.slice(0, 5), method: "corpus" };
  }

  // Uncertain band → Exa fallback (only if key present).
  if (top >= env.plagExaLow() && top < env.plagExaHigh() && env.exaKey()) {
    const exaMatches = await exaSearch(mcq.question, 5);
    // Treat any Exa hit with score > 0.7 as flagged (Exa's own neural relevance).
    const strong = exaMatches.filter((m) => m.similarity > 0.7);
    if (strong.length > 0) {
      return { verdict: "flagged", matches: [...corpus.slice(0, 3), ...strong].slice(0, 5), method: "corpus+exa" };
    }
    return { verdict: "unique", matches: corpus.slice(0, 3), method: "corpus+exa" };
  }

  return { verdict: "unique", matches: corpus.slice(0, 3), method: "corpus" };
}

function pickDistinctiveLine(code?: string | null): string | null {
  if (!code) return null;
  const lines = code
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 20)
    .filter((l) => !/^(print\(|console\.log|System\.out|int main|public static void)/.test(l))
    .filter((l) => !/^[\/\/#*]/.test(l));
  return lines[0] ?? null;
}
