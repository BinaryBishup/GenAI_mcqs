import { env } from "./env";

const VOYAGE_API = "https://api.voyageai.com/v1/embeddings";

export interface VoyageOptions {
  /** "document" for corpus rows; "query" for runtime lookups. */
  inputType?: "document" | "query";
  truncation?: boolean;
}

export async function embed(
  texts: string[],
  opts: VoyageOptions = {},
): Promise<number[][]> {
  if (texts.length === 0) return [];
  const res = await fetch(VOYAGE_API, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.voyageKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      input: texts,
      model: env.voyageModel(),
      input_type: opts.inputType ?? "query",
      truncation: opts.truncation ?? true,
    }),
  });
  if (!res.ok) {
    throw new Error(`Voyage embed failed: ${res.status} ${await res.text()}`);
  }
  const json = await res.json();
  return (json.data as { embedding: number[] }[]).map((d) => d.embedding);
}
