// Provider-agnostic LLM access.
//
// Every model call in the app goes through `llm()`. Swapping providers means
// writing one driver in lib/ai/providers/ and setting LLM_PROVIDER — no call
// site changes. The interface is deliberately the narrow subset the pipeline
// actually needs: a system prompt, a message list, a token cap, text back.
//
// Anything provider-specific (Anthropic's prompt caching, its native PDF
// reading) is expressed as an optional hint or an optional capability, so a
// driver that lacks it degrades instead of breaking.

import type { LlmProvider } from "./providers/types";
import { anthropicProvider } from "./providers/anthropic";
import { inHouseProvider } from "./providers/inhouse";

export type { LlmProvider, LlmMessage, CompleteRequest, CompleteResult } from "./providers/types";

let _provider: LlmProvider | null = null;

/**
 * The active provider, chosen by LLM_PROVIDER (default "anthropic").
 * Cached per process — change the env var and restart to switch.
 */
export function llm(): LlmProvider {
  if (_provider) return _provider;
  const name = (process.env.LLM_PROVIDER || "anthropic").trim().toLowerCase();
  switch (name) {
    case "anthropic":
      _provider = anthropicProvider();
      break;
    case "inhouse":
      _provider = inHouseProvider();
      break;
    default:
      throw new Error(`Unknown LLM_PROVIDER "${name}" — expected "anthropic" or "inhouse"`);
  }
  return _provider;
}

/**
 * Strip an outer ```json fence wrapper from a model response.
 *
 * The MCQ payload itself contains ```java / ```python fenced blocks inside
 * the option strings (Shape B: "which implementation is correct?"). So a
 * non-greedy regex that matches the *first* closing ``` will truncate the
 * JSON at the first inner fence. We instead:
 *   1. Strip a leading ```json|``` opener if present.
 *   2. Strip a trailing ``` closer if present (greedy from the end).
 *   3. Locate the first '[' or '{' and return from there.
 *
 * Provider-independent: any model that wraps JSON in a fence needs this.
 */
export function extractJson(text: string): string {
  let t = text.trim();
  const opener = t.match(/^```(?:json)?\s*\n?/i);
  if (opener) {
    t = t.slice(opener[0].length);
    // Walk back from the end to drop a trailing closing fence (if any).
    t = t.replace(/\s*```\s*$/, "");
  }
  const start = t.search(/[\[{]/);
  if (start === -1) return t.trim();
  return t.slice(start).trim();
}
