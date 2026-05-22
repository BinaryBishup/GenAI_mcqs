import type { Difficulty, Language, MCQType } from "./types";

interface SampleForPrompt {
  topic: string;
  difficulty: string;
  type: string;
  question: string;
  options: string[];
  correct_index: number;
  language?: string | null;
  code?: string | null;
}

export const SYSTEM_INSTRUCTIONS = `You generate multiple-choice questions (MCQs) that mimic the style and rigor of provided sample MCQs.

## Hard rules (structure — non-negotiable)
- Output ONLY a JSON array. No prose, no markdown, no code fences.
- Each MCQ MUST have exactly 4 options.
- Questions must be NOVEL — paraphrase phrasing, change identifiers, change numeric values. Do not reproduce textbook questions verbatim.
- For type=code: the snippet must be self-contained and produce a single deterministic stdout that, after .strip(), equals options[correct_index] exactly.
- correct_index is a 0-based int (0..3).
- explanation is 1-2 sentences explaining why the correct answer is correct.

## Difficulty calibration
- **easy** — direct recall or one-step application of a definition or common syntax.
- **medium** — short chain of reasoning: trace a small loop, pick the right method, apply a rule with one twist.
- **hard** — edge cases, corner behaviour, multi-step trace, common gotchas experienced practitioners trip on.

## Output shape (array of objects)
[
  {
    "id": "<short-slug>",
    "type": "general" | "code",
    "topic": "<topic>",
    "difficulty": "easy" | "medium" | "hard",
    "question": "...",
    "options": ["A","B","C","D"],
    "correct_index": 0,
    "explanation": "...",
    "snippet": { "language": "<lang>", "code": "..." }    // only when type=code
  }
]

Additional quality rules will be supplied per-call in the user message.`;

// ---------------------------------------------------------------------------
// Per-call quality rules — toggleable from the UI. The user picks which to
// enable; buildUserPrompt injects only the enabled ones into the user message.
// ---------------------------------------------------------------------------
export interface QualityRule {
  id: string;
  label: string;          // short chip label
  text: string;           // injected into the prompt
  appliesTo?: "code";     // omit = applies to all MCQ types
}

export const QUALITY_RULES: QualityRule[] = [
  {
    id: "length-parity",
    label: "Match option lengths",
    text: "Option-length parity: all four options MUST be roughly the same length (within ~20% character count). A correct option noticeably longer than its distractors telegraphs the answer. If the right answer naturally wants more words, pad distractors with similar fluff to match.",
  },
  {
    id: "plausible-distractors",
    label: "Plausible distractors",
    text: "Plausible distractors: every wrong option must be one a competent but mistaken test-taker would realistically pick. Build them from common misconceptions, off-by-one errors, swapped variables, mixed-up concepts, or near-miss numerics — not obvious garbage.",
  },
  {
    id: "cluster-distractors",
    label: "Cluster distractors near answer",
    text: "Distractors cluster around the correct answer: wrong options should sit close enough that elimination requires thought. For numerics, cluster near the right value (correct=42 → distractors 41, 43, 84 rather than 7, 1000). For concepts, share vocabulary and domain with the correct option.",
  },
  {
    id: "parallel-structure",
    label: "Parallel option structure",
    text: "Parallel structure: all options share grammar and form — all noun phrases, OR all complete sentences, OR all numeric, OR all code outputs. Same punctuation. Same level of detail.",
  },
  {
    id: "no-giveaway-words",
    label: "No giveaway words",
    text: "No giveaway words: don't repeat distinctive words from the stem only in the correct option. Don't use absolute qualifiers (\"always\", \"never\", \"all\", \"none\", \"only\") only in distractors — test-savvy candidates flag those by reflex.",
  },
  {
    id: "no-all-of-above",
    label: "No All/None of the above",
    text: 'Avoid "All of the above" / "None of the above" as either correct answer or distractor — they break the distractor-similarity assumption.',
  },
  {
    id: "single-concept",
    label: "Single concept per question",
    text: "One question, one concept: no compound stems, no double negatives, no questions whose answer depends on misreading the stem.",
  },
  {
    id: "single-correct-answer",
    label: "Single defensibly-correct answer",
    text: "Exactly one defensibly-correct answer: if a domain expert could argue for two options, rewrite.",
  },
  // ---- code-only ----
  {
    id: "real-bug-distractors",
    label: "Real-bug distractors (code)",
    text: "For code MCQs, distractors should look like real bugs: off-by-one iteration count, wrong type coercion, wrong operator precedence, off-by-index, mutated-vs-returned confusion, wrong scope.",
    appliesTo: "code",
  },
  {
    id: "short-snippets",
    label: "Short snippets ≤12 lines (code)",
    text: "For code MCQs, the snippet must be short and self-contained — aim for ≤ 12 lines. No external imports beyond stdlib. No I/O beyond stdout.",
    appliesTo: "code",
  },
  {
    id: "deterministic-output",
    label: "Deterministic output (code)",
    text: "For code MCQs, output must be deterministic — no random, no time-based output, no dict-iteration-order-dependent output unless the answer accounts for it.",
    appliesTo: "code",
  },
  {
    id: "single-concept-snippet",
    label: "Single concept in code (code)",
    text: "For code MCQs, stay on topic. If testing list slicing, don't also require knowing exception handling — single concept under test per question.",
    appliesTo: "code",
  },
];

/** All rule IDs — the default when the client doesn't specify a subset. */
export const DEFAULT_RULE_IDS: string[] = QUALITY_RULES.map((r) => r.id);

/** Render the enabled rules as a numbered block for the user prompt. */
function buildQualityRulesBlock(enabledIds: string[], mcqType: MCQType): string {
  const enabled = new Set(enabledIds);
  const applicable = QUALITY_RULES.filter((r) => enabled.has(r.id))
    .filter((r) => !r.appliesTo || r.appliesTo === mcqType);
  if (applicable.length === 0) return "";
  return [
    "Quality rules for this batch:",
    ...applicable.map((r, i) => `${i + 1}. ${r.text}`),
  ].join("\n");
}

export function buildSamplesBlock(samples: SampleForPrompt[]): string {
  if (samples.length === 0) return "[no samples provided]";
  const lines: string[] = [];
  lines.push(`<samples count="${samples.length}">`);
  for (const s of samples) {
    lines.push("---");
    lines.push(`type: ${s.type}`);
    lines.push(`topic: ${s.topic}`);
    lines.push(`difficulty: ${s.difficulty}`);
    if (s.language) lines.push(`language: ${s.language}`);
    lines.push(`question: ${s.question}`);
    if (s.code) {
      lines.push("code:");
      lines.push("```");
      lines.push(s.code);
      lines.push("```");
    }
    s.options.forEach((o, i) => lines.push(`option ${i}: ${o}`));
    lines.push(`correct_index: ${s.correct_index}`);
  }
  lines.push("</samples>");
  return lines.join("\n");
}

export function buildUserPrompt(args: {
  count: number;
  topic: string;
  difficulty: Difficulty;
  mcqType: MCQType;
  languages: Language[];
  samplesBlock: string;
  freeFormSamples?: string;
  /** Free-form text the user added in the "Additional instructions" field. */
  extraInstructions?: string;
  negativePrompt?: string;
  /** Subset of QUALITY_RULES ids to apply this call. Defaults to all rules. */
  qualityRules?: string[];
}): string {
  const langs = args.mcqType === "code" && args.languages.length > 0
    ? `Languages allowed: ${args.languages.join(", ")}. Pick one language per question; vary across the set.`
    : "";
  const rulesBlock = buildQualityRulesBlock(args.qualityRules ?? DEFAULT_RULE_IDS, args.mcqType);
  const extra = args.extraInstructions?.trim()
    ? `\nAdditional instructions from the user:\n${args.extraInstructions.trim()}`
    : "";
  const avoid = args.negativePrompt?.trim()
    ? `\nAvoid the following:\n${args.negativePrompt.trim()}`
    : "";
  const instruction = [
    `Generate ${args.count} novel MCQs.`,
    `Topic: ${args.topic}`,
    `Difficulty: ${args.difficulty}`,
    `Type: ${args.mcqType}`,
    langs,
    "",
    rulesBlock,
    extra,
    avoid,
    "",
    "Output: a JSON array, exactly the schema in the system message. No prose.",
  ].filter(Boolean).join("\n");

  return [
    args.samplesBlock,
    args.freeFormSamples ? `\nAdditional sample notes:\n${args.freeFormSamples}` : "",
    "",
    instruction,
  ].filter(Boolean).join("\n");
}

export function buildRevampPrompt(args: {
  mcq: {
    type: MCQType;
    topic: string;
    difficulty: Difficulty;
    question: string;
    options: string[];
    correct_index: number;
    snippet?: { language: Language; code: string } | null;
  };
  matches: { url: string; question: string }[];
}): string {
  const matchSummary = args.matches
    .slice(0, 3)
    .map((m, i) => `Match ${i + 1} (${m.url}):\n${m.question}`)
    .join("\n\n");
  return [
    "The following MCQ was flagged as too similar to existing public sources. Rewrite it.",
    "",
    "Constraints:",
    "- Preserve the concept and difficulty.",
    "- Change the surface form: numbers, identifiers, scenario, phrasing.",
    "- For code MCQs, rewrite the snippet so its stdout still equals one of the new options.",
    "- Keep exactly 4 options. Output ONLY the rewritten MCQ as a JSON object (not an array, no fences).",
    "",
    "## Flagged matches",
    matchSummary,
    "",
    "## Current MCQ",
    JSON.stringify(args.mcq, null, 2),
  ].join("\n");
}

export function buildDistractorPrompt(args: {
  question: string;
  actual_output: string;
  language: Language;
  code: string;
}): string {
  return [
    "A code MCQ's snippet runs and produces this actual stdout:",
    `\`\`\`\n${args.actual_output}\n\`\`\``,
    "",
    `Question: ${args.question}`,
    `Language: ${args.language}`,
    "",
    "Code:",
    "```",
    args.code,
    "```",
    "",
    "Write exactly 3 plausible WRONG distractor options that a student might pick. They should be the kind of outputs a similar program could produce — off-by-one, wrong type, common misunderstandings. Do not include the actual output. Output a JSON array of exactly 3 strings, no prose.",
  ].join("\n");
}
