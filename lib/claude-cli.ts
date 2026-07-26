/**
 * Development-only model transport that runs prompts through the Claude Code
 * CLI (`claude -p`) instead of the Anthropic API. The CLI bills the local
 * Claude subscription, so the whole app stays usable when the API key has no
 * credits (or isn't set at all).
 *
 * NEVER used in production: enable() returns false unless NODE_ENV !== production.
 * Set CLAUDE_CLI_FALLBACK=0 to opt out entirely, or =1 to force it on (skipping
 * the API attempt) when you know the key is dead.
 */
import { spawn } from "child_process";
import { mkdtemp, writeFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

const TIMEOUT_MS = Number(process.env.CLAUDE_CLI_TIMEOUT_MS || 600_000);

/**
 * Every fallback call spawns a full Claude Code process (hundreds of MB), while
 * the pipeline fans out aggressively — 5 generate batches, one review call per
 * chunk, 4 verify workers. Unbounded, that is 10+ heavy processes at once and
 * enough memory pressure to take the dev server down with it. Serialise them
 * behind a small gate: runs are slower, but they finish.
 */
const MAX_CONCURRENT = Math.max(1, Number(process.env.CLAUDE_CLI_CONCURRENCY || 2));
let active = 0;
const waiting: Array<() => void> = [];

async function acquire(): Promise<void> {
  if (active < MAX_CONCURRENT) {
    active++;
    return;
  }
  await new Promise<void>((resolve) => waiting.push(resolve));
  active++;
}

function release(): void {
  active--;
  waiting.shift()?.();
}

export function cliFallbackEnabled(): boolean {
  if (process.env.CLAUDE_CLI_FALLBACK === "0") return false;
  if (process.env.NODE_ENV === "production") return false;
  return true;
}

/** Force the CLI without even trying the API (dead key → skip a wasted round trip). */
export function cliForced(): boolean {
  return cliFallbackEnabled() && process.env.CLAUDE_CLI_FALLBACK === "1";
}

/** True for API errors the CLI can rescue: no credits, bad/missing key, rate limits. */
export function isBillingOrAuthError(e: unknown): boolean {
  const msg = (e instanceof Error ? e.message : String(e ?? "")).toLowerCase();
  return (
    msg.includes("credit balance is too low") ||
    msg.includes("invalid x-api-key") ||
    msg.includes("authentication_error") ||
    msg.includes("missing required env var: anthropic_api_key") ||
    msg.includes("rate_limit_error") ||
    msg.includes("insufficient")
  );
}

/** Map a configured model id (claude-sonnet-4-6) to a CLI alias the subscription resolves. */
function cliModel(model: string): string {
  const m = (model || "").toLowerCase();
  if (m.includes("haiku")) return "haiku";
  if (m.includes("opus")) return "opus";
  return "sonnet";
}

type TextBlock = { type: "text"; text: string };
type DocBlock = { type: "document"; source: { type: "base64"; media_type: string; data: string } };
type ImageBlock = { type: "image"; source: { type: "base64"; media_type: string; data: string } };
type AnyBlock = TextBlock | DocBlock | ImageBlock | { type: string; [k: string]: unknown };

export interface CliRequest {
  model: string;
  system?: string | Array<{ type: "text"; text: string }>;
  messages: Array<{ role: string; content: string | AnyBlock[] }>;
}

/** Flatten an Anthropic-shaped system field into one plain string. */
function flattenSystem(system: CliRequest["system"]): string {
  if (!system) return "";
  if (typeof system === "string") return system;
  return system.map((b) => b.text).join("\n\n");
}

/**
 * Flatten message content into a prompt string. Binary blocks (PDFs, images)
 * can't ride on stdin, so they're written to a temp dir and referenced by path;
 * the CLI is given Read access to that dir only.
 */
async function flattenMessages(
  messages: CliRequest["messages"],
  dir: string,
): Promise<{ prompt: string; wroteFiles: boolean }> {
  const parts: string[] = [];
  let wroteFiles = false;
  let n = 0;
  for (const msg of messages) {
    if (typeof msg.content === "string") {
      parts.push(msg.content);
      continue;
    }
    for (const block of msg.content) {
      if (block.type === "text") {
        parts.push((block as TextBlock).text);
      } else if (block.type === "document" || block.type === "image") {
        const src = (block as DocBlock | ImageBlock).source;
        if (src?.type !== "base64") continue;
        const ext = src.media_type?.includes("pdf") ? "pdf" : (src.media_type?.split("/")[1] ?? "bin");
        const file = join(dir, `attachment-${++n}.${ext}`);
        await writeFile(file, Buffer.from(src.data, "base64"));
        wroteFiles = true;
        parts.push(`Read the attached file at ${file} and use its contents to answer.`);
      }
    }
  }
  return { prompt: parts.filter(Boolean).join("\n\n"), wroteFiles };
}

/** Run one prompt through `claude -p` and return the assistant's text. */
export async function runViaCli(req: CliRequest): Promise<string> {
  await acquire();
  const dir = await mkdtemp(join(tmpdir(), "mcq-cli-"));
  try {
    const { prompt, wroteFiles } = await flattenMessages(req.messages, dir);
    const args = ["-p", "--model", cliModel(req.model), "--output-format", "text"];
    const system = flattenSystem(req.system);
    if (system) args.push("--system-prompt", system);
    if (wroteFiles) args.push("--add-dir", dir, "--allowedTools", "Read");

    // Strip the (dead) API key so the CLI authenticates with the subscription.
    const env = { ...process.env };
    delete env.ANTHROPIC_API_KEY;
    delete env.ANTHROPIC_AUTH_TOKEN;

    return await new Promise<string>((resolve, reject) => {
      const child = spawn("claude", args, { env, stdio: ["pipe", "pipe", "pipe"] });
      let out = "";
      let err = "";
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error(`claude CLI timed out after ${TIMEOUT_MS}ms`));
      }, TIMEOUT_MS);

      child.stdout.on("data", (d) => { out += d.toString(); });
      child.stderr.on("data", (d) => { err += d.toString(); });
      child.on("error", (e) => {
        clearTimeout(timer);
        reject(new Error(`claude CLI not runnable: ${e.message}`));
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (code !== 0) reject(new Error(`claude CLI exited ${code}: ${err.slice(0, 400)}`));
        else if (!out.trim()) reject(new Error("claude CLI returned empty output"));
        else resolve(out.trim());
      });

      child.stdin.end(prompt);
    });
  } finally {
    release();
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
