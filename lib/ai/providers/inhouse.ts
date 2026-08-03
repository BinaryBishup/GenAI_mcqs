// In-house LLM driver — NOT YET IMPLEMENTED.
//
// The company model is served over a custom HTTP contract that has not been
// specified yet. This file is the single place that needs writing to move off
// Anthropic: implement `complete()` (and `readPdfText` if the model can read
// documents), then set LLM_PROVIDER=inhouse. No call site changes.
//
// To finish it we need, from whoever owns the service:
//   • base URL + path, and the auth scheme (bearer token / mTLS / IAM / header)
//   • the request JSON: how a system prompt, a multi-turn message list and a
//     token cap are expressed
//   • the response JSON: where the generated text lives, plus stop-reason and
//     token-usage fields if they exist
//   • model identifiers for the fast / balanced / highest tiers
//   • whether it supports prompt caching (a large stable system prefix) and
//     whether it can accept a PDF/document, or if we must extract text locally
//
// Everything else in the app is already provider-agnostic.

import type { CompleteRequest, CompleteResult, LlmProvider } from "./types";

const NOT_CONFIGURED =
  "LLM_PROVIDER=inhouse but the in-house driver is not implemented yet. " +
  "Fill in lib/ai/providers/inhouse.ts with the company model's HTTP contract, " +
  "or set LLM_PROVIDER=anthropic.";

function baseUrl(): string {
  const u = process.env.LLM_BASE_URL?.trim();
  if (!u) throw new Error("LLM_BASE_URL is not set");
  return u.replace(/\/+$/, "");
}

function apiKey(): string {
  const k = process.env.LLM_API_KEY?.trim();
  if (!k) throw new Error("LLM_API_KEY is not set");
  return k;
}

export function inHouseProvider(): LlmProvider {
  return {
    name: "inhouse",

    async complete(_req: CompleteRequest): Promise<CompleteResult> {
      // Reference the config readers so the intended wiring is obvious and the
      // env vars are validated as soon as someone switches the provider on.
      void baseUrl;
      void apiKey;
      throw new Error(NOT_CONFIGURED);
    },

    // `readPdfText` is intentionally absent: until we know whether the model
    // accepts documents, /api/scratch/ingest should reject PDFs with a clear
    // message rather than silently producing an empty digest. If the model
    // cannot read documents, implement this with a local PDF text extractor.
  };
}
