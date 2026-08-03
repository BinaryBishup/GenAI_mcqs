import { llm, extractJson } from "@/lib/ai/llm";
import { env } from "@/lib/env";
import type { AnswerCheckStatus, MCQ } from "@/lib/types";

export interface AnswerCheckResult {
  status: AnswerCheckStatus;
  /** Option index the independent checker chose (null if it couldn't commit). */
  index: number | null;
  /** One-line rationale. */
  notes: string;
}

const LETTERS = ["A", "B", "C", "D", "E", "F"];

/**
 * Independently re-derive the correct answer for a NON-code MCQ and compare it
 * to the option the generator declared correct.
 *
 * Why: code MCQs ("what's the output?") are grounded by executing the snippet
 * by running it. But Shape-B ("which implementation is correct?"), Shape-C ("which
 * statement is true?") and all general/conceptual MCQs have no such ground
 * truth — the generator's `correct_index` is simply trusted. This is the main
 * place a plausible-but-wrong answer slips through. We send the question to a
 * *separate* model call that does NOT see which option was marked correct,
 * have it solve the question from scratch, then compare:
 *   - same index               → "agree"
 *   - different index (high conf) → "disagree" (we surface the checker's pick)
 *   - low confidence / abstain  → "uncertain"
 *
 * Grounding (if available) is injected so the checker reasons from real
 * reference material rather than its own memory — lowering its own error rate.
 *
 * Never throws: any failure returns "uncertain" so the pipeline keeps moving.
 */
export async function checkAnswer(mcq: MCQ, groundingBlock?: string, modelOverride?: string): Promise<AnswerCheckResult> {
  // Code MCQs are verified by execution, not by an LLM re-read.
  if (mcq.type === "code") {
    return { status: "skipped", index: null, notes: "code MCQ — verified by execution path" };
  }
  if (!Array.isArray(mcq.options) || mcq.options.length < 2) {
    return { status: "skipped", index: null, notes: "no options to check" };
  }

  const optionsText = mcq.options
    .map((o, i) => `${LETTERS[i]}. ${o}`)
    .join("\n");

  const ground = groundingBlock?.trim()
    ? `\nUse this reference material as the source of truth. If it does not settle the question, rely on well-established domain knowledge and lower your confidence:\n${groundingBlock.trim()}\n`
    : "";

  const prompt = [
    "You are an exacting subject-matter expert grading a multiple-choice question.",
    "Solve it INDEPENDENTLY. You are NOT told which option is marked correct — decide for yourself.",
    ground,
    `Question:\n${mcq.question}`,
    mcq.snippet?.code ? `\nCode:\n\`\`\`${mcq.snippet.language ?? ""}\n${mcq.snippet.code}\n\`\`\`` : "",
    `\nOptions:\n${optionsText}`,
    "",
    "Pick the single best option. Consider whether MORE THAN ONE option could be defensibly correct (a quality defect).",
    'Respond with ONLY a JSON object, no prose: {"answer": "A"|"B"|"C"|"D", "confidence": "high"|"medium"|"low", "multiple_defensible": true|false, "reason": "<one short sentence>"}',
  ].filter(Boolean).join("\n");

  try {
    const msg = await llm().complete({
      // Independent checker — defaults to balanced, but the pipeline passes the
      // strongest model so it's a genuinely independent second opinion (not the
      // generation model second-guessing itself).
      model: modelOverride ?? env.modelFor("balanced"),
      maxTokens: 1200,
      messages: [{ role: "user", content: prompt }],
    });
    const parsed = JSON.parse(extractJson(msg.text)) as {
      answer?: string;
      confidence?: string;
      multiple_defensible?: boolean;
      reason?: string;
    };

    const letter = String(parsed.answer ?? "").trim().toUpperCase().slice(0, 1);
    const idx = LETTERS.indexOf(letter);
    const conf = String(parsed.confidence ?? "").toLowerCase();
    const reason = (parsed.reason ?? "").toString().slice(0, 200);

    if (idx < 0 || idx >= mcq.options.length) {
      return { status: "uncertain", index: null, notes: reason || "checker returned no valid option" };
    }

    // Ambiguity is itself a defect even if the checker happened to land on the
    // declared answer.
    if (parsed.multiple_defensible === true) {
      return {
        status: "uncertain",
        index: idx,
        notes: reason || "checker flagged more than one defensibly-correct option",
      };
    }

    if (idx === mcq.correct_index) {
      return { status: "agree", index: idx, notes: reason };
    }
    // Different pick. A low-confidence disagreement is "uncertain" (don't trust
    // the checker over the generator on a coin-flip); a confident one is a real
    // disagreement worth surfacing.
    if (conf === "low") {
      return { status: "uncertain", index: idx, notes: reason || "low-confidence disagreement" };
    }
    return {
      status: "disagree",
      index: idx,
      notes: reason || `checker chose ${LETTERS[idx]}, generator marked ${LETTERS[mcq.correct_index]}`,
    };
  } catch (e) {
    return { status: "uncertain", index: null, notes: `check failed: ${(e as Error).message}` };
  }
}

export interface ArbitrateResult {
  /** The definitively-correct option index, or null if genuinely ambiguous/unsolvable. */
  index: number | null;
  /** True when more than one option is defensibly correct or the question is ill-posed. */
  ambiguous: boolean;
  /** A clean, final 1–2 sentence justification for the chosen answer. */
  explanation: string;
}

/**
 * Tie-breaker / arbiter. Two solvers disagreed on the correct option; this is a
 * final, careful adjudication that shows its work, then commits to the single
 * correct option — or declares the question ambiguous (no single defensible
 * answer). Lets the pipeline RESTORE a correct question a fallible checker
 * mis-flagged, FIX a genuinely wrong key, or flag a truly ill-posed item.
 * Never throws.
 */
export async function arbitrate(mcq: MCQ, challengerIndex: number | null, modelOverride?: string): Promise<ArbitrateResult> {
  if (!Array.isArray(mcq.options) || mcq.options.length < 2) {
    return { index: mcq.correct_index, ambiguous: false, explanation: "" };
  }
  const optionsText = mcq.options.map((o, i) => `${LETTERS[i]}. ${o}`).join("\n");
  const marked = LETTERS[mcq.correct_index] ?? "?";
  const challenger = challengerIndex != null ? LETTERS[challengerIndex] ?? "?" : "?";
  const prompt = [
    "You are the final arbiter on a multiple-choice question. Two solvers disagreed:",
    `  • Solver 1 (the author) marked option ${marked} correct.`,
    `  • Solver 2 (an independent checker) chose option ${challenger}.`,
    "Solve the question yourself, from scratch, carefully. Work through the arithmetic/logic STEP BY STEP and double-check it before deciding. Then commit to the SINGLE correct option.",
    "If — and only if — more than one option is genuinely defensibly correct, or the question is ill-posed / has no single correct answer (e.g. an ambiguous 'overall loss' across a buy/sell/buyback chain), set ambiguous=true.",
    "",
    `Question:\n${mcq.question}`,
    mcq.snippet?.code ? `\nCode:\n\`\`\`\n${mcq.snippet.code}\n\`\`\`` : "",
    `\nOptions:\n${optionsText}`,
    "",
    "Put ALL of your step-by-step working in the \"work\" field. The \"explanation\" field must be a CLEAN, FINAL 1–2 sentence justification of the chosen option for a student — NO scratch work, NO 'let me recompute', NO hedging.",
    'Respond with ONLY a JSON object: {"work": "<your full reasoning>", "correct": "A"|"B"|"C"|"D", "ambiguous": true|false, "explanation": "<clean final justification>"}',
  ].filter(Boolean).join("\n");

  try {
    const msg = await llm().complete({
      model: modelOverride ?? env.modelFor("highest"),
      maxTokens: 1500,
      messages: [{ role: "user", content: prompt }],
    });
    const parsed = JSON.parse(extractJson(msg.text)) as { correct?: string; ambiguous?: boolean; explanation?: string; work?: string };
    if (parsed.ambiguous === true) {
      return { index: null, ambiguous: true, explanation: (parsed.explanation ?? "").slice(0, 300) };
    }
    const idx = LETTERS.indexOf(String(parsed.correct ?? "").trim().toUpperCase().slice(0, 1));
    if (idx < 0 || idx >= mcq.options.length) {
      return { index: null, ambiguous: true, explanation: "arbiter returned no valid option" };
    }
    return { index: idx, ambiguous: false, explanation: (parsed.explanation ?? "").slice(0, 300) };
  } catch {
    // Arbiter failed → don't destroy a possibly-correct question; trust the author.
    return { index: mcq.correct_index, ambiguous: false, explanation: "" };
  }
}
