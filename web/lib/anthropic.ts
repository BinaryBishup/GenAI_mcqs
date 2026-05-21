import Anthropic from "@anthropic-ai/sdk";
import { env } from "./env";

let _client: Anthropic | null = null;

export function anthropic(): Anthropic {
  if (_client) return _client;
  _client = new Anthropic({ apiKey: env.anthropicKey() });
  return _client;
}

/** Strip ```json fences and trailing junk from a model response. */
export function extractJson(text: string): string {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) return fence[1].trim();
  // Try to locate the first { or [ and the matching closer.
  const start = text.search(/[\[{]/);
  if (start === -1) return text.trim();
  return text.slice(start).trim();
}
