import { runCode } from "./judge0";
import { anthropic, extractJson } from "./anthropic";
import { buildDistractorPrompt } from "./prompts";
import { env } from "./env";
import type { MCQ, VerifyOutcome } from "./types";

/**
 * Run a code MCQ's snippet, compare stdout to the declared correct option,
 * and return the verdict + any required mutation.
 *
 * The caller applies the mutation (this function is pure aside from Judge0 + Claude).
 */
export async function verifyCodeMCQ(mcq: MCQ): Promise<VerifyOutcome> {
  if (!mcq.snippet || mcq.type !== "code") {
    return {
      verified: null,
      actual_stdout: "",
      fix: "skipped_unsupported_language",
      new_correct_index: null,
      stderr: "not a code MCQ",
    };
  }

  const r = await runCode(mcq.snippet.language, mcq.snippet.code);
  const actual = r.stdout.trim();
  const declared = (mcq.options[mcq.correct_index] ?? "").trim();

  if (!r.ok && /no host toolchain/i.test(r.stderr)) {
    return {
      verified: null,
      actual_stdout: actual,
      fix: "skipped_unsupported_language",
      new_correct_index: null,
      stderr: r.stderr,
    };
  }
  if (r.exit_code === 124) {
    return { verified: false, actual_stdout: actual, fix: "timeout", new_correct_index: null, stderr: r.stderr };
  }
  if (!r.ok) {
    return {
      verified: false,
      actual_stdout: actual,
      fix: "compile_or_runtime_error",
      new_correct_index: null,
      stderr: r.stderr,
    };
  }

  if (actual === declared) {
    return { verified: true, actual_stdout: actual, fix: "none", new_correct_index: null, stderr: "" };
  }

  // Does actual match a different option?
  const otherIdx = mcq.options.findIndex((o, i) => i !== mcq.correct_index && o.trim() === actual);
  if (otherIdx >= 0) {
    return {
      verified: true,
      actual_stdout: actual,
      fix: "reassigned_correct_index",
      new_correct_index: otherIdx,
      stderr: "",
    };
  }

  return {
    verified: true,  // we'll fix it with new distractors below
    actual_stdout: actual,
    fix: "regenerate_options",
    new_correct_index: null,
    stderr: "",
  };
}

/** Apply a verify outcome to the MCQ in place, regenerating distractors if needed. */
export async function applyVerifyFix(mcq: MCQ, outcome: VerifyOutcome): Promise<MCQ> {
  mcq.code_actual_output = outcome.actual_stdout;
  mcq.code_verified = outcome.verified;
  mcq.code_fix = outcome.fix;

  if (outcome.fix === "reassigned_correct_index" && outcome.new_correct_index != null) {
    mcq.correct_index = outcome.new_correct_index;
    return mcq;
  }

  if (outcome.fix === "regenerate_options" && mcq.snippet) {
    const distractors = await generateDistractors({
      question: mcq.question,
      actual_output: outcome.actual_stdout,
      language: mcq.snippet.language,
      code: mcq.snippet.code,
    });
    const options = [outcome.actual_stdout, ...distractors].slice(0, 4);
    // Shuffle deterministically using a hash of mcq.id so the run is reproducible.
    const order = stableShuffle(options.length, mcq.id);
    const shuffled = order.map((i) => options[i]);
    const newCorrectIdx = order.indexOf(0);
    mcq.options = shuffled;
    mcq.correct_index = newCorrectIdx;
    return mcq;
  }

  return mcq;
}

async function generateDistractors(args: {
  question: string;
  actual_output: string;
  language: import("./types").Language;
  code: string;
}): Promise<string[]> {
  const msg = await anthropic().messages.create({
    model: env.modelFor("fast"),
    max_tokens: 400,
    messages: [{ role: "user", content: buildDistractorPrompt(args) }],
  });
  const text = msg.content
    .flatMap((b) => (b.type === "text" ? [b.text] : []))
    .join("\n");
  try {
    const arr = JSON.parse(extractJson(text));
    if (Array.isArray(arr) && arr.every((s) => typeof s === "string")) {
      return arr.slice(0, 3);
    }
  } catch { /* fall through */ }
  // Last-resort fallback distractors so we never block the pipeline.
  return ["(no output)", "Error", "Undefined"];
}

function stableShuffle(n: number, seed: string): number[] {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  const indices = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    h = Math.imul(h ^ (h >>> 13), 16777619);
    const j = Math.abs(h) % (i + 1);
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  return indices;
}
