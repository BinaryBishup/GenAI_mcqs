import { env } from "./env";

const TAVILY_API = "https://api.tavily.com/search";

export interface TavilyResult {
  url: string;
  title?: string;
  content?: string;
  score?: number;
}

/**
 * Quick web search via Tavily. Returns up to `maxResults` hits with title +
 * content snippet. Cheap (~$0.008/query). Used as the "is this question
 * already on the public web?" probe in the plag check.
 */
export async function tavilySearch(query: string, maxResults = 5): Promise<TavilyResult[]> {
  const key = env.tavilyKey();
  if (!key) return [];

  const res = await fetch(TAVILY_API, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query,
      max_results: maxResults,
      search_depth: "basic",
      include_answer: false,
      include_raw_content: false,
    }),
  });

  if (!res.ok) {
    console.warn(`Tavily ${res.status}: ${await res.text().catch(() => "")}`);
    return [];
  }
  const json = await res.json();
  return (json.results ?? []) as TavilyResult[];
}

export interface TavilyGrounding {
  answer: string | null;
  results: TavilyResult[];
}

/**
 * Richer search used to GROUND generation (not plag). Asks Tavily for a
 * synthesized answer plus the top sources' content, so the model can be told
 * to only assert facts supported here. ~1 call per batch — much cheaper than
 * per-question. Returns empty grounding (not an error) when the key is missing.
 */
export async function tavilyGround(query: string, maxResults = 6): Promise<TavilyGrounding> {
  const key = env.tavilyKey();
  if (!key) return { answer: null, results: [] };

  try {
    const res = await fetch(TAVILY_API, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query,
        max_results: maxResults,
        search_depth: "advanced",
        include_answer: "advanced",
        include_raw_content: false,
      }),
    });
    if (!res.ok) {
      console.warn(`Tavily ground ${res.status}: ${await res.text().catch(() => "")}`);
      return { answer: null, results: [] };
    }
    const json = await res.json();
    return {
      answer: typeof json.answer === "string" ? json.answer : null,
      results: (json.results ?? []) as TavilyResult[],
    };
  } catch (e) {
    console.warn("tavilyGround error:", (e as Error).message);
    return { answer: null, results: [] };
  }
}
