// Provider-agnostic embeddings, used for semantic dedup (catching
// reworded-but-identical questions that lexical fuzz misses). Server-only.
//
// Selected by EMBEDDINGS_PROVIDER (default "voyage"). The in-house service is
// configured independently of the LLM — different host, different auth — so it
// gets its own env vars rather than sharing LLM_BASE_URL.
//
// NOTE: vectors from different models are not comparable. Switching provider or
// model invalidates any stored embedding; the dedup pass embeds per-run in
// memory, so nothing needs re-indexing today, but that changes if we ever
// persist vectors.

const BATCH = 128;
const MAX_CHARS = 8000;

export type InputType = "document" | "query";

interface EmbeddingsProvider {
  readonly name: string;
  embed(batch: string[], inputType: InputType): Promise<number[][]>;
}

// ---------------------------------------------------------------- voyage

const VOYAGE_URL = "https://api.voyageai.com/v1/embeddings";

const voyage: EmbeddingsProvider = {
  name: "voyage",
  async embed(batch, inputType) {
    const key = process.env.VOYAGE_API_KEY?.trim();
    if (!key) throw new Error("VOYAGE_API_KEY missing");
    const model = process.env.VOYAGE_EMBEDDING_MODEL?.trim() || "voyage-3.5";

    const res = await fetch(VOYAGE_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ input: batch, model, input_type: inputType }),
    });
    if (!res.ok) throw new Error(`voyage embed failed: ${res.status} ${await res.text().catch(() => "")}`);
    const json = (await res.json()) as { data?: { embedding: number[]; index: number }[] };
    return (json.data ?? []).slice().sort((a, b) => a.index - b.index).map((d) => d.embedding);
  },
};

// ---------------------------------------------------------------- in-house

/**
 * In-house embeddings — NOT YET IMPLEMENTED.
 *
 * To finish it we need, from whoever owns the service:
 *   • base URL + path and the auth scheme
 *   • the request JSON (how a batch of strings is passed, and the max batch size)
 *   • the response JSON (where the vectors live, and whether order is guaranteed)
 *   • the model id and its dimensionality
 *   • whether it distinguishes document vs query embeddings
 */
const inhouse: EmbeddingsProvider = {
  name: "inhouse",
  async embed() {
    const url = process.env.EMBEDDINGS_BASE_URL?.trim();
    if (!url) throw new Error("EMBEDDINGS_BASE_URL is not set");
    throw new Error(
      "EMBEDDINGS_PROVIDER=inhouse but the in-house embeddings driver is not implemented yet. " +
        "Fill in the `inhouse` provider in lib/ai/embed.ts, or set EMBEDDINGS_PROVIDER=voyage.",
    );
  },
};

function provider(): EmbeddingsProvider {
  const name = (process.env.EMBEDDINGS_PROVIDER || "voyage").trim().toLowerCase();
  if (name === "voyage") return voyage;
  if (name === "inhouse") return inhouse;
  throw new Error(`Unknown EMBEDDINGS_PROVIDER "${name}" — expected "voyage" or "inhouse"`);
}

/** Embed a batch of texts. Returns one vector per input, in order.
 *  Throws on transport / API error. */
export async function embedTexts(texts: string[], inputType: InputType = "document"): Promise<number[][]> {
  if (texts.length === 0) return [];
  const p = provider();
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += BATCH) {
    const batch = texts.slice(i, i + BATCH).map((t) => (t || "").slice(0, MAX_CHARS));
    out.push(...(await p.embed(batch, inputType)));
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
