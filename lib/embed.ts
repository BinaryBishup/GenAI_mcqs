// Voyage embeddings — used for semantic dedup (catching reworded-but-identical
// questions that lexical fuzz misses). Server-only (uses VOYAGE_API_KEY).

const VOYAGE_URL = "https://api.voyageai.com/v1/embeddings";

function voyageKey(): string {
  const k = process.env.VOYAGE_API_KEY?.trim();
  if (!k) throw new Error("VOYAGE_API_KEY missing");
  return k;
}
function voyageModel(): string {
  return process.env.VOYAGE_EMBEDDING_MODEL?.trim() || "voyage-3.5";
}

/** Embed a batch of texts (chunked under Voyage's per-request cap). Returns one
 *  vector per input, in order. Throws on transport / API error. */
export async function embedTexts(texts: string[], inputType: "document" | "query" = "document"): Promise<number[][]> {
  if (texts.length === 0) return [];
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += 128) {
    const batch = texts.slice(i, i + 128).map((t) => (t || "").slice(0, 8000));
    const res = await fetch(VOYAGE_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${voyageKey()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ input: batch, model: voyageModel(), input_type: inputType }),
    });
    if (!res.ok) throw new Error(`voyage embed failed: ${res.status} ${await res.text().catch(() => "")}`);
    const json = (await res.json()) as { data?: { embedding: number[]; index: number }[] };
    const data = (json.data ?? []).slice().sort((a, b) => a.index - b.index);
    for (const d of data) out.push(d.embedding);
  }
  return out;
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** Highest cosine of `vec` against any vector in `against` (0 if empty). */
export function maxCosine(vec: number[], against: number[][]): { score: number; index: number } {
  let score = 0, index = -1;
  for (let i = 0; i < against.length; i++) {
    const c = cosine(vec, against[i]);
    if (c > score) { score = c; index = i; }
  }
  return { score, index };
}
