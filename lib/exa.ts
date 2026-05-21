import { env } from "./env";
import type { PlagMatch } from "./types";

const EXA_API = "https://api.exa.ai/search";

interface ExaResult {
  url: string;
  title?: string;
  text?: string;
  score?: number;
}

/** Neural search; great for paraphrase-style plagiarism detection. */
export async function exaSearch(query: string, numResults = 5): Promise<PlagMatch[]> {
  const key = env.exaKey();
  if (!key) return [];
  const res = await fetch(EXA_API, {
    method: "POST",
    headers: {
      "x-api-key": key,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query,
      type: "neural",
      numResults,
      contents: { text: { maxCharacters: 400 } },
    }),
  });
  if (!res.ok) {
    console.warn(`Exa search failed: ${res.status} ${await res.text()}`);
    return [];
  }
  const json = await res.json();
  const results = (json.results as ExaResult[]) ?? [];
  return results.map((r) => ({
    source: "exa",
    url: r.url,
    similarity: r.score ?? 0,
    question: r.text?.slice(0, 200) ?? r.title ?? "",
  }));
}
