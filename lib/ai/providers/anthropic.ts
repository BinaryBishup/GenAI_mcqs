// Anthropic driver — the current production provider.
//
// Keeps the two Anthropic-specific capabilities the pipeline benefits from:
//   • prompt caching on the large system prefix (cache_control: ephemeral)
//   • native PDF reading (document content blocks)
// Both are expressed through the neutral LlmProvider interface, so a driver
// without them degrades rather than breaking.

import Anthropic from "@anthropic-ai/sdk";
import { env } from "@/lib/env";
import { cliFallbackEnabled, cliForced, isBillingOrAuthError, runViaCli, type CliRequest } from "@/lib/ai/claude-cli";
import type { CompleteRequest, CompleteResult, LlmProvider } from "./types";

let _client: Anthropic | null = null;

/** Shape the SDK callers already expect. */
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
  // never patched, and `raw` is the facade we hand out with the fallback wired in.
  const key = process.env.ANTHROPIC_API_KEY?.trim() || "missing-key-cli-fallback";
  const inner = new Anthropic({ apiKey: key });
  const raw = new Anthropic({ apiKey: key });
  const realCreate = inner.messages.create.bind(inner.messages);

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

  _client = raw;
  return _client;
}

/** Concatenate the text blocks of a reply, ignoring any non-text block. */
function textOf(content: unknown): string {
  if (!Array.isArray(content)) {
    // A network interceptor can yield a non-array body instead of an error.
    throw new Error("Anthropic API unreachable (network intercepted the request)");
  }
  return content
    .flatMap((b: { type?: string; text?: string }) => (b.type === "text" && b.text ? [b.text] : []))
    .join("\n");
}

type RawReply = {
  content: unknown;
  stop_reason?: string | null;
  usage?: { input_tokens?: number; output_tokens?: number };
};
type CreateArgs = Parameters<Anthropic["messages"]["create"]>[0];

export function anthropicProvider(): LlmProvider {
  return {
    name: "anthropic",

    async complete(req: CompleteRequest): Promise<CompleteResult> {
      // A cacheable system prefix must be sent as a block array carrying
      // cache_control; a plain string cannot express it.
      const system = req.system
        ? req.cacheSystem
          ? [{ type: "text" as const, text: req.system, cache_control: { type: "ephemeral" as const } }]
          : req.system
        : undefined;

      const msg = (await anthropic().messages.create({
        model: req.model,
        max_tokens: req.maxTokens,
        ...(system ? { system } : {}),
        messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
      } as CreateArgs)) as RawReply;

      return {
        text: textOf(msg.content),
        stopReason: msg.stop_reason ?? null,
        inputTokens: msg.usage?.input_tokens ?? 0,
        outputTokens: msg.usage?.output_tokens ?? 0,
      };
    },

    /** Claude accepts the PDF bytes directly — no local text extraction needed. */
    async readPdfText(base64Pdf: string, system: string, maxTokens: number): Promise<string> {
      const res = (await anthropic().messages.create({
        model: env.modelFor("fast"),
        max_tokens: maxTokens,
        system,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "document",
                source: { type: "base64", media_type: "application/pdf", data: base64Pdf },
              },
            ],
          },
        ],
      } as CreateArgs)) as RawReply;
      return textOf(res.content).trim();
    },
  };
}
