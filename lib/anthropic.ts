import Anthropic from "@anthropic-ai/sdk";
import { env } from "./env";

let _client: Anthropic | null = null;

export function anthropic(): Anthropic {
  if (_client) return _client;
  _client = new Anthropic({ apiKey: env.anthropicKey() });
  return _client;
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
