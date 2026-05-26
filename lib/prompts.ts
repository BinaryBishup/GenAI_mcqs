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

export const SYSTEM_INSTRUCTIONS = `You generate multiple-choice questions (MCQs) that REPLICATE the exact surface shape of a provided sample set.

## TOP PRIORITY — Format parity (overrides everything else)
The single most important requirement is that your output MCQs are visually and structurally indistinguishable from the supplied samples. Before generating, look at every sample and answer for yourself:
  1. Where does code live? In the question stem? In the options? In both? In neither?
  2. What are the options? Full code snippets? Full sentences? Short noun phrases? Short stdout strings? A mix?
  3. How long is the question stem (word count)? Does it have a scenario setup?
  4. What is the opening pattern ("Assume that...", "Consider that...", "A team is...")?
  5. Is there a code listing presented in the stem followed by "What will be the output?" — or is the question "Which implementation is correct?" with code in options — or "Which statements are true?" with sentence options?

Then DISTRIBUTE your generated MCQs across the SAME shapes you see, in roughly the SAME ratios. If 4 of 5 samples have code inside the options and 1 of 5 has a "what's printed" stdout question, your output must follow that same 4:1 ratio. Do NOT default to one shape because it is easier — the samples drive the shape.

## The three canonical code-MCQ shapes (pick per question based on samples)
SHAPE A — "What is the output?" (code-in-stem, stdout-string options)
  - question contains "What will be printed/returned/output?"
  - question.snippet holds the code; type = "code"
  - options are 4 short strings (a single printed value or short line)
  - correct option = the actual deterministic stdout of the snippet
SHAPE B — "Which implementation/snippet is correct?" (code-in-options)
  - question is a scenario describing a method/class to implement; may include a partial code skeleton
  - type = "general"  (NOT code — execution is not what is tested)
  - question.snippet is OMITTED, OR holds only setup/skeleton code
  - each of the 4 options is a fenced code block (\`\`\`lang\\n...\\n\`\`\`) showing a different candidate implementation
  - correct option = the snippet that actually solves the problem
SHAPE C — "Which statements about this code are true?" (code-in-stem, sentence options)
  - question contains a code listing then asks which behaviour/statement holds
  - type = "code"; question.snippet holds the code
  - options are 4 full sentences (each makes a claim about the code's behaviour)
  - correct option = the true statement

## Hard rules (structure — non-negotiable)
- Output ONLY a JSON array. No prose, no markdown, no code fences around the array.
- Each MCQ MUST have exactly 4 options.
- Questions must be NOVEL — paraphrase phrasing, change identifiers, change numeric values. Do not reproduce textbook questions verbatim.
- correct_index is a 0-based int (0..3).
- explanation is 1-2 sentences explaining why the correct answer is correct.
- For SHAPE A only: snippet must be self-contained and produce a single deterministic stdout that, after .strip(), equals options[correct_index] exactly.
- For SHAPE B: keep code in options short enough to read at a glance (≤ 15 lines). Use real fenced blocks with the language tag (\`\`\`java, \`\`\`python, etc.). Use the SAME language for all 4 option snippets in a given question.
- Question stem length must fall inside the question_words min–max range from <format_profile>. Aim for the avg.
- The user-requested mcq_type ("code" vs "general") is a hint about whether to involve code at all; the SPECIFIC shape (A/B/C) is dictated by the samples, not the request.

## Mimic sample shape (length & format parity)
- Match question stem length (word count) to the sample range.
- Match option style: short noun phrases → short noun phrases; full code snippets → full code snippets; full sentences → full sentences.
- Match opening pattern: "Consider that…", "Assume that…", "A team is working on…", "A code is written as:".
- Match the number of options (always 4) and ratio of code-options to text-options to what samples show.

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
    "snippet": { "language": "<lang>", "code": "..." }    // include for SHAPE A and SHAPE C; omit for SHAPE B
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

function wordCount(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

function range(nums: number[]): { min: number; max: number; avg: number } {
  if (nums.length === 0) return { min: 0, max: 0, avg: 0 };
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const avg = Math.round(nums.reduce((a, b) => a + b, 0) / nums.length);
  return { min, max, avg };
}

const CODE_HINTS_RX = /```|\bclass\s|\bpublic\s|\bprivate\s|\bvoid\s|\bstatic\s|\breturn\s|=>\s|;\s*$|\bSystem\.|\bfunction\s|\bdef\s|\bint\s|\bdouble\s|\bString\s/m;

function optionLooksLikeCode(o: string): boolean {
  return CODE_HINTS_RX.test(o);
}

/**
 * Classify each sample by which of the three canonical shapes it represents.
 * Shape A = code in stem, stdout-string options ("what's printed?")
 * Shape B = no/skeleton code in stem, fenced code snippets as options ("which impl?")
 * Shape C = code in stem, full-sentence options ("which statement is true?")
 */
function classifyShape(s: SampleForPrompt): "A" | "B" | "C" {
  const optsCode = s.options.filter(optionLooksLikeCode).length;
  const optsLong = s.options.filter((o) => wordCount(o) >= 6).length;
  if (optsCode >= 2) return "B";
  if (s.code && optsLong >= 2) return "C";
  if (s.code) return "A";
  if (optsCode >= 2) return "B";
  return "C";
}

/**
 * Derive concrete numeric targets so the model can match sample shape, not
 * just sample topic. Injected at the top of the samples block.
 */
function buildFormatProfile(samples: SampleForPrompt[], requestedCount: number): string {
  if (samples.length === 0) return "";
  const qWords = samples.map((s) => wordCount(s.question));
  const optWords: number[] = [];
  let codeInQ = 0;
  let codeInOpts = 0;
  const shapeCounts: Record<"A" | "B" | "C", number> = { A: 0, B: 0, C: 0 };
  for (const s of samples) {
    s.options.forEach((o) => optWords.push(wordCount(o)));
    if (s.code) codeInQ++;
    if (s.options.some(optionLooksLikeCode)) codeInOpts++;
    shapeCounts[classifyShape(s)]++;
  }
  const qr = range(qWords);
  const or = range(optWords);
  const pct = (n: number) => Math.round((n / samples.length) * 100);
  // Translate sample-shape ratios into a concrete per-output target so the
  // model can't dodge the "match the distribution" instruction.
  const targetA = Math.round((shapeCounts.A / samples.length) * requestedCount);
  const targetB = Math.round((shapeCounts.B / samples.length) * requestedCount);
  let targetC = requestedCount - targetA - targetB;
  if (targetC < 0) targetC = 0;
  const lines = [
    "<format_profile>",
    `samples_seen: ${samples.length}`,
    `question_words: min=${qr.min}, max=${qr.max}, avg=${qr.avg}  (every generated stem MUST land in this range — aim for the average)`,
    `option_words:   min=${or.min}, max=${or.max}, avg=${or.avg}  (per-option; the four options in one MCQ must be parallel in length to each other)`,
    `code_in_question: ${pct(codeInQ)}% of samples place a code snippet in the question stem`,
    `code_in_options:  ${pct(codeInOpts)}% of samples place code snippets inside the option strings`,
    "shape_distribution_in_samples:",
    `  Shape A (code in stem, short stdout options — "what's printed?"): ${shapeCounts.A}/${samples.length}`,
    `  Shape B (code IN OPTIONS, "which implementation is correct?"): ${shapeCounts.B}/${samples.length}`,
    `  Shape C (code in stem, sentence options — "which statement is true?"): ${shapeCounts.C}/${samples.length}`,
    "required_output_distribution:",
    `  You are generating ${requestedCount} MCQs. Emit roughly: ${targetA} of Shape A, ${targetB} of Shape B, ${targetC} of Shape C.`,
    "  This distribution is a hard requirement — do NOT emit all Shape A if samples are dominated by B or C.",
    "</format_profile>",
  ];
  return lines.join("\n");
}

export function buildSamplesBlock(samples: SampleForPrompt[], requestedCount = 5): string {
  if (samples.length === 0) return "[no samples provided]";
  const lines: string[] = [];
  lines.push(buildFormatProfile(samples, requestedCount));
  lines.push(`<samples count="${samples.length}">`);
  for (const s of samples) {
    const shape = classifyShape(s);
    lines.push("---");
    lines.push(`shape: ${shape}   (A=output / B=code-in-options / C=sentence-options)`);
    lines.push(`type: ${s.type}`);
    lines.push(`topic: ${s.topic}`);
    lines.push(`difficulty: ${s.difficulty}`);
    if (s.language) lines.push(`language: ${s.language}`);
    lines.push(`question (${wordCount(s.question)} words): ${s.question}`);
    if (s.code) {
      lines.push("code:");
      lines.push("```");
      lines.push(s.code);
      lines.push("```");
    }
    s.options.forEach((o, i) => lines.push(`option ${i} (${wordCount(o)} words${optionLooksLikeCode(o) ? ", CODE" : ""}): ${o}`));
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
    `Type hint (overall): ${args.mcqType}  — but the actual per-question SHAPE (A/B/C) comes from <format_profile> above, not from this hint.`,
    langs,
    "",
    "FORMAT PARITY IS THE #1 REQUIREMENT — it overrides every other rule below. Before generating:",
    "  1. Read <format_profile> and the per-sample 'shape:' labels.",
    "  2. Match the required_output_distribution EXACTLY (Shape A count + Shape B count + Shape C count).",
    "  3. For each MCQ, before writing it, decide its shape and confirm: stem length in question_words range, options follow the shape's option style, code lives where samples put it.",
    "  4. If samples use code IN OPTIONS (Shape B), each of your 4 options must be a fenced code block (```java …```), NOT a 1-word stdout string.",
    "  5. If samples use sentence options (Shape C), each option must be a full declarative sentence, NOT a 1-word value.",
    "Generating all-Shape-A 'what is printed?' questions when samples are dominated by Shape B/C is the most common mistake — do not make it.",
    "",
    rulesBlock,
    extra,
    avoid,
    "",
    "Output: a JSON array, exactly the schema in the system message. No prose, no markdown fences around the array.",
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
