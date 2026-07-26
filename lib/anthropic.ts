import Anthropic from "@anthropic-ai/sdk";
import { env } from "./env";
import { cliFallbackEnabled, cliForced, isBillingOrAuthError, runViaCli, type CliRequest } from "./claude-cli";

let _client: Anthropic | null = null;

/** Shape both `messages.create` and `messages.stream` callers already expect. */
function cliMessage(text: string) {
  return {
    content: [{ type: "text" as const, text }],
    stop_reason: "end_turn" as const,
    usage: { input_tokens: 0, output_tokens: 0 },
  };
}

/**
 * The real SDK client, wrapped in development with a Claude Code CLI fallback:
 * when the API rejects a call for billing/auth reasons (a dead key, no credits),
 * the same prompt is replayed through `claude -p` on the local subscription so
 * the app keeps working. Production always uses the API directly.
 */
export function anthropic(): Anthropic {
  if (_client) return _client;

  // Without the CLI fallback a missing key must still throw, as before.
  if (!cliFallbackEnabled()) {
    _client = new Anthropic({ apiKey: env.anthropicKey() });
    return _client;
  }

  // A missing key is fine in dev — the CLI covers it. Two clients: `inner` is
  // never patched (the SDK's stream() calls its own create() internally, which
  // must keep returning a real APIPromise), and `raw` is the facade we hand out
  // with the fallback wired in.
  const key = process.env.ANTHROPIC_API_KEY?.trim() || "missing-key-cli-fallback";
  const inner = new Anthropic({ apiKey: key });
  const raw = new Anthropic({ apiKey: key });
  const realCreate = inner.messages.create.bind(inner.messages);
  const realStream = inner.messages.stream.bind(inner.messages);

  const viaCli = async (body: unknown, label: string) => {
    const text = await runViaCli(body as CliRequest);
    console.warn(`[anthropic] ${label} served by the Claude Code CLI (API unavailable — dev fallback)`);
    return cliMessage(text);
  };

  raw.messages.create = (async (body: never, options?: never) => {
    if (cliForced()) return viaCli(body, "messages.create");
    try {
      return await realCreate(body, options);
    } catch (e) {
      if (!isBillingOrAuthError(e)) throw e;
      return viaCli(body, "messages.create");
    }
  }) as typeof raw.messages.create;

  // Callers only ever use `.finalMessage()` on the returned stream, so the
  // fallback returns a stand-in exposing just that.
  raw.messages.stream = ((body: never, options?: never) => {
    if (cliForced()) {
      const p = viaCli(body, "messages.stream");
      return { finalMessage: () => p } as ReturnType<typeof realStream>;
    }
    let stream: ReturnType<typeof realStream> | null = null;
    try {
      stream = realStream(body, options);
    } catch (e) {
      if (!isBillingOrAuthError(e)) throw e;
    }
    const finalMessage = async () => {
      try {
        if (stream) return await stream.finalMessage();
      } catch (e) {
        if (!isBillingOrAuthError(e)) throw e;
      }
      return viaCli(body, "messages.stream");
    };
    return { ...(stream ?? {}), finalMessage } as ReturnType<typeof realStream>;
  }) as typeof raw.messages.stream;

  _client = raw;
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
