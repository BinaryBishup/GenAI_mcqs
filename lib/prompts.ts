import type { Difficulty, Language, MCQType, QuestionKind } from "./types";

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

## Factual accuracy (non-negotiable — a wrong answer key is worse than a dull question)
- The option you mark correct MUST actually be correct, and every distractor MUST actually be wrong. Exactly one option is defensibly correct.
- Do NOT invent APIs, methods, syntax, numbers, dates, or behaviours you are not certain of. If you are unsure a fact is true, do not build a question on it.
- If a <reference_material> block is provided in the user message, treat it as the source of truth: ground every factual claim in it and do not assert anything it does not support. Prefer questions whose answer the reference material clearly settles.
- The explanation must correctly justify the correct answer using real reasoning — never a circular restatement.

## Question-type taxonomy (classify EVERY question as exactly one)
Before writing each MCQ, decide whether it is APPLICATION or ANALYSIS, and build it to that type's rules. Code/SQL can appear in EITHER type — it is a vehicle, not a type.

APPLICATION — "Can I USE my knowledge to perform or implement something?"
  - Applies a known concept, syntax, command, function, or procedure to a practical situation.
  - Has ONE direct, defensibly-correct answer; the focus is implementation or execution.
  - The candidate decides WHAT to do, or WHAT the output will be.
  - Vehicles: code snippets, config/CLI commands, SQL statements, or concrete business scenarios.
  - Typical asks/verbs: "Which query/command should be used?", "What will this code return?", "How would you implement X?", "Configure / write / create / apply / calculate / determine…".

ANALYSIS — "Can I REASON about behaviour, consequences, relationships, or best practices?"
  - Requires reasoning, not recall: examine information, compare alternatives, interpret results, find the root cause, weigh trade-offs, judge the most appropriate approach.
  - Often troubleshooting, optimisation, best-practice, architecture, or output-interpretation.
  - Has SEVERAL plausible distractors — eliminating them requires understanding WHY.
  - Typical asks/verbs: "Why is X preferred?", "What is the impact of this design choice?", "What happens if…?", "Which approach is most appropriate and why?", "Identify the root cause", "Compare / evaluate / interpret / assess / justify…".

Boundary note: the SAME code can yield either type — "What will this code return?" is APPLICATION; "Why does this query give unexpected results?" or "What happens after a rollback to a savepoint?" is ANALYSIS. The user message states which type(s) to produce (from-scratch) or which type to match (from samples).

## Hard rules (structure — non-negotiable)
- Output ONLY a raw JSON array. Your FIRST character MUST be '[' and your LAST character MUST be ']'. No \`\`\`json, no \`\`\`, no leading "Here is...", no trailing prose, no explanation outside the array. Any wrapping is a parse failure.
- Each MCQ MUST have exactly 4 options.
- Questions must be NOVEL — paraphrase phrasing, change identifiers, change numeric values. Do not reproduce textbook questions verbatim.
- correct_index is a 0-based int (0..3).
- explanation is 1-2 sentences explaining why the correct answer is correct. Refer to options by their CONTENT (e.g., "the public setBalance method") — NEVER by position ("Option 0", "the first option"). The system shuffles option order after generation, so positional references in the explanation become wrong.
- The explanation MUST be a CLEAN, FINAL justification. NEVER include working-out scratch, hedging, or self-correction ("Wait", "let me recalculate", "re-checking", "actually") — do your reasoning silently and state only the final, confident justification. The correct_index MUST point to the option whose CONTENT your explanation justifies; if they would disagree, recompute until they agree before emitting.
- Vary which position you place the correct answer at. Do not put the correct answer at index 0 on most questions — distribute correct_index roughly uniformly across 0, 1, 2, 3 over the batch.
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

/**
 * Scratch mode (no sample file): synthesise a generation profile from the
 * question "kinds" the user picked, so the model still has concrete shape
 * guidance and the quality rules remain meaningful without samples to imitate.
 */
export function buildScratchProfile(
  kinds: QuestionKind[],
  count: number,
  mcqType: MCQType,
): string {
  const set = new Set<QuestionKind>(kinds.length ? kinds : ["application", "analysis"]);
  const types = [...set];
  const codeVehicle = mcqType === "code";
  const lines: string[] = [
    "<generation_profile>",
    "No sample file is provided — you are generating from the topic directly. Follow the question-type taxonomy in the system instructions and this profile:",
    `total: ${count} MCQs, each with exactly 4 options.`,
  ];
  if (types.length === 2) {
    lines.push("requested_types: produce a roughly even mix of APPLICATION and ANALYSIS questions; label each in your head and build it to that type's rules.");
  } else if (types[0] === "application") {
    lines.push("requested_types: ALL questions must be APPLICATION (use/implement/execute; one direct correct answer).");
  } else {
    lines.push("requested_types: ALL questions must be ANALYSIS (reason about behaviour/consequences/best practices; several plausible distractors).");
  }
  if (codeVehicle) {
    lines.push(
      "code_vehicle: ON — frame questions around code/SQL. For APPLICATION put a short deterministic snippet in question.snippet and ask which implementation is correct / what it returns; for ANALYSIS show code/SQL and ask why it behaves a certain way, what happens, or which approach is best. Keep snippets short and self-contained.",
    );
  } else {
    lines.push(
      "code_vehicle: OFF — use prose scenarios and concepts, no code snippet in the stem unless genuinely essential.",
    );
  }
  lines.push(
    "distractors: APPLICATION = one clearly-correct option, the rest clearly wrong; ANALYSIS = several plausible options that require reasoning to eliminate.",
    "option_style: all four options parallel in form and within ~20% of each other in length.",
    "stem_length: roughly 20–60 words; analysis / scenario stems may run longer for setup.",
    "</generation_profile>",
  );
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
  /** Prompt-ready <reference_material> block from the grounding step. */
  groundingBlock?: string;
  /** 'scratch' = no samples; drive shape from questionKinds instead. */
  mode?: "sample" | "scratch";
  questionKinds?: QuestionKind[];
  /** Sample mode: detected Application/Analysis type of the source samples, if known. */
  sampleTypeHint?: QuestionKind | null;
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
  const isScratch = args.mode === "scratch";
  const ground = args.groundingBlock?.trim()
    ? [
        "GROUND YOUR FACTS — a <reference_material> block is provided above. Every factual claim, correct answer, and distractor must be consistent with it. Do not assert anything it does not support; if it is silent on a point, fall back only to well-established, certain knowledge. Prefer questions the reference clearly settles.",
        "",
      ]
    : [];

  const sampleType = args.sampleTypeHint;
  const typeBlock = isScratch
    ? []
    : [
        "",
        "QUESTION TYPE — apply the question-type taxonomy in the system instructions:",
        sampleType
          ? `  These samples are ${sampleType.toUpperCase()} questions. Every MCQ you generate MUST be ${sampleType.toUpperCase()} too — ${sampleType === "application" ? "use/implement a concept with ONE direct correct answer" : "require reasoning about behaviour/consequences/best practices, with SEVERAL plausible distractors"}.`
          : "  Classify each sample as APPLICATION or ANALYSIS, then match the same type, framing, and distractor style in your generated questions.",
      ];

  const shapeBlock = isScratch
    ? [
        "FOLLOW THE <generation_profile> ABOVE. Before generating:",
        "  1. Decide each question's TYPE (Application or Analysis) per requested_types, then build it to that type's rules.",
        "  2. Write a stem and 4 parallel options that fit the type — Application = one direct correct answer; Analysis = several plausible distractors needing reasoning to eliminate.",
        "  3. If code_vehicle is ON, put deterministic code/SQL in question.snippet where it fits the type.",
        "  4. Vary scenarios (industries, use cases), entity names, and the concept under test from question to question — do not replicate one template.",
      ]
    : [
        "FORMAT PARITY IS THE #1 REQUIREMENT — it overrides every other rule below. Before generating:",
        "  1. Read <format_profile> and the per-sample 'shape:' labels.",
        "  2. Match the required_output_distribution EXACTLY (Shape A count + Shape B count + Shape C count).",
        "  3. For each MCQ, before writing it, decide its shape and confirm: stem length in question_words range, options follow the shape's option style, code lives where samples put it.",
        "  4. If samples use code IN OPTIONS (Shape B), each of your 4 options must be a fenced code block (```java …```), NOT a 1-word stdout string.",
        "  5. If samples use sentence options (Shape C), each option must be a full declarative sentence, NOT a 1-word value.",
        "Generating all-Shape-A 'what is printed?' questions when samples are dominated by Shape B/C is the most common mistake — do not make it.",
        "",
        "PATTERN VARIETY ACROSS THE BATCH — when the same source file gives you many samples, those samples cover several distinct question patterns (definition lookup, scenario→service, troubleshooting, comparison, true-statement, etc.). DO NOT pick one pattern and replicate it across all your generated MCQs. Spread your output across the different patterns visible in the samples, in roughly the proportions they appear. Vary scenarios (industries, use cases), entity names, and concepts under test from question to question.",
      ];

  const instruction = [
    `Generate ${args.count} novel MCQs.`,
    `Topic: ${args.topic}`,
    `Difficulty: ${args.difficulty}`,
    isScratch
      ? `Type hint (overall): ${args.mcqType} — per-question shape comes from <generation_profile> above.`
      : `Type hint (overall): ${args.mcqType}  — but the actual per-question SHAPE (A/B/C) comes from <format_profile> above, not from this hint.`,
    langs,
    "",
    ...ground,
    ...shapeBlock,
    ...typeBlock,
    "",
    rulesBlock,
    extra,
    avoid,
    "",
    "Output: a raw JSON array. First character must be '['. Do NOT wrap the array in ```json fences — fences cause a parse failure.",
  ].filter(Boolean).join("\n");

  return [
    args.groundingBlock?.trim() ? args.groundingBlock.trim() : "",
    isScratch
      ? buildScratchProfile(args.questionKinds ?? [], args.count, args.mcqType)
      : args.samplesBlock,
    args.freeFormSamples ? `\nAdditional sample notes:\n${args.freeFormSamples}` : "",
    "",
    instruction,
  ].filter(Boolean).join("\n");
}

/**
 * Per-seed expansion ("item cloning"): produce `count` novel variants of ONE
 * reference question. Each variant must keep the seed's concept, shape, type,
 * and difficulty — but be clearly distinct from the reference AND from its
 * siblings. Distribution across the bank is preserved because every variant
 * inherits its seed's properties.
 */
export function buildVariantPrompt(args: {
  seed: SampleForPrompt & { code?: string | null; language?: string | null };
  count: number;
  languages: Language[];
  extraInstructions?: string;
  negativePrompt?: string;
  qualityRules?: string[];
  groundingBlock?: string;
  /** Sibling questions already produced for this seed — the new ones must differ from these. */
  avoidQuestions?: string[];
}): string {
  const { seed } = args;
  const seedType: MCQType = seed.type === "code" ? "code" : "general";
  const shape = classifyShape(seed);
  const rulesBlock = buildQualityRulesBlock(args.qualityRules ?? DEFAULT_RULE_IDS, seedType);
  const langLine =
    seedType === "code" && seed.language
      ? `Keep the same language (${seed.language}) for the code in every variant.`
      : seedType === "code" && args.languages.length > 0
        ? `Languages allowed: ${args.languages.join(", ")}.`
        : "";
  const extra = args.extraInstructions?.trim()
    ? `\nAdditional instructions from the user:\n${args.extraInstructions.trim()}`
    : "";
  const avoid = args.negativePrompt?.trim()
    ? `\nAvoid the following:\n${args.negativePrompt.trim()}`
    : "";
  const ground = args.groundingBlock?.trim()
    ? "GROUND YOUR FACTS — a <reference_material> block is provided above. Every factual claim, correct answer, and distractor must be consistent with it; do not assert anything it does not support."
    : "";

  const refLines: string[] = [
    "<reference_question>",
    `shape: ${shape}   (A=output / B=code-in-options / C=sentence-options)`,
    `type: ${seed.type}`,
    `topic: ${seed.topic}`,
    `difficulty: ${seed.difficulty}`,
  ];
  if (seed.language) refLines.push(`language: ${seed.language}`);
  refLines.push(`question (${wordCount(seed.question)} words): ${seed.question}`);
  if (seed.code) {
    refLines.push("code:");
    refLines.push("```");
    refLines.push(seed.code);
    refLines.push("```");
  }
  seed.options.forEach((o, i) =>
    refLines.push(`option ${i}${i === seed.correct_index ? " [CORRECT]" : ""} (${wordCount(o)} words${optionLooksLikeCode(o) ? ", CODE" : ""}): ${o}`),
  );
  refLines.push("</reference_question>");

  const avoidBlock =
    args.avoidQuestions && args.avoidQuestions.length > 0
      ? [
          "",
          "Questions you have ALREADY produced for this reference — every new question MUST be clearly different from each of these (different scenario, values, and phrasing):",
          ...args.avoidQuestions.map((q, i) => `  ${i + 1}. ${q}`),
        ]
      : [];

  const stemW = wordCount(seed.question);
  const optW = seed.options.map(wordCount);
  const minO = Math.min(...optW);
  const maxO = Math.max(...optW);
  const avgO = Math.round(optW.reduce((a, b) => a + b, 0) / optW.length);
  const shortOpts = maxO <= 4;
  const longOpts = avgO >= 8;
  const stemLo = Math.max(4, Math.round(stemW * 0.7));
  const stemHi = Math.round(stemW * 1.3);
  const optExamples = seed.options.slice(0, 2).map((o) => `"${o}"`).join(", ");

  const instruction = [
    `Generate ${args.count} NEW multiple-choice question${args.count === 1 ? "" : "s"} modelled on the reference question above.`,
    "",
    "LENGTH & STYLE — MATCH THE REFERENCE EXACTLY (HARD CONSTRAINT — violating this fails the task):",
    `  - STEM: the reference stem is ${stemW} words. Your stem MUST be ${stemLo}–${stemHi} words. Do not add extra clauses, framing, or 'Select the correct option…' boilerplate unless the reference has it.`,
    `  - OPTIONS: the reference options are ${minO}–${maxO} words each (avg ~${avgO}; e.g. ${optExamples}). EVERY option you write MUST be ${minO}–${maxO} words and the SAME grammatical form.${shortOpts ? " These are SHORT terms/noun-phrases — your options must be equally short. Long descriptive phrases or full sentences are WRONG here." : ""}${longOpts ? ` These are LONG, detailed options (~${avgO} words each) — your options MUST be equally long and fully detailed clauses/sentences. Do NOT compress them into short phrases; under-length options are WRONG here.` : ""}`,
    "  - Mirror the reference's verbosity precisely: a terse reference → terse output; a wordy reference → wordy output. Never inflate a concise sample into a verbose question.",
    "",
    "DIVERSITY IS ALSO REQUIRED — the new questions must be genuinely different, not reskins of the reference:",
    "  - Keep the SAME concept being tested, the SAME shape (A/B/C), the SAME type (general/code), and the SAME difficulty as the reference.",
    "  - But make each variant clearly DISTINCT from the reference AND from one another — change the scenario/domain, the entities and names, the concrete values, the framing, and which option is correct.",
    "  - Do NOT merely rename variables or tweak a number. A reader who saw the reference must not feel they are answering the same question again.",
    langLine,
    seed.code
      ? "For SHAPE A code questions, each variant's snippet must produce a single deterministic stdout that equals its correct option after .strip()."
      : "",
    "",
    ground,
    "",
    rulesBlock,
    extra,
    avoid,
    ...avoidBlock,
    "",
    "Output: a raw JSON array of MCQ objects (same schema as the system instructions). First character '[', last character ']'. No ``` fences, no prose.",
  ].filter(Boolean).join("\n");

  return [
    args.groundingBlock?.trim() ? args.groundingBlock.trim() : "",
    refLines.join("\n"),
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

// ---------------------------------------------------------------------------
// Final review pass — a single strict reviewer that verifies every generated
// MCQ is correct, on-concept, unique, and on-quality, returning a JSON verdict
// array. Replaces the old grounding / plagiarism / Judge0 / diversity stack.
// ---------------------------------------------------------------------------
export const REVIEW_SYSTEM = `You are a strict multiple-choice question (MCQ) quality reviewer.
You are given a set of SOURCE questions (the concept reference) and a set of GENERATED questions to audit.
For each generated question you must judge correctness, concept match, uniqueness, difficulty, and option quality, then return a verdict.
Any explanation you write or fix MUST be a clean, final, confident justification — never your reasoning process, never hedging ('Wait', 're-checking'), never option-position talk. The marked correct_index and the explanation must always agree.
You output ONLY a raw JSON array — your FIRST character MUST be '[' and your LAST character MUST be ']'. No prose, no markdown, no \`\`\` fences. Any wrapping is a failure.`;

export function buildReviewPrompt(args: {
  generated: {
    index: number;
    question: string;
    options: string[];
    correct_index: number;
    explanation?: string | null;
    snippet?: { language: string; code: string } | null;
    /** The exact format of the source sample this question was modelled on. */
    sampleFormat?: { stemWords: number; optMin: number; optMax: number; example: string } | null;
  }[];
  sources: { question: string; options: string[]; correct_index: number }[];
  difficulty: Difficulty;
  mcqType: MCQType;
  extraInstructions?: string;
  negativePrompt?: string;
}): string {
  const sourceLines: string[] = ["<source_questions> (concept reference — the generated questions should test the SAME concepts at the SAME quality/difficulty)"];
  if (args.sources.length === 0) {
    sourceLines.push("[none provided]");
  } else {
    args.sources.forEach((s, i) => {
      sourceLines.push("---");
      sourceLines.push(`source ${i + 1}: ${s.question}`);
      s.options.forEach((o, j) =>
        sourceLines.push(`  option ${j}${j === s.correct_index ? " [correct]" : ""}: ${o}`),
      );
    });
  }
  sourceLines.push("</source_questions>");

  const genLines: string[] = ["<generated_questions> (audit each — use the GLOBAL index shown)"];
  for (const g of args.generated) {
    genLines.push("---");
    genLines.push(`index: ${g.index}`);
    genLines.push(`question: ${g.question}`);
    if (g.snippet?.code) {
      genLines.push(`snippet (${g.snippet.language}):`);
      genLines.push("```");
      genLines.push(g.snippet.code);
      genLines.push("```");
    }
    g.options.forEach((o, j) =>
      genLines.push(`  option ${j}${j === g.correct_index ? " [marked correct]" : ""}: ${o}`),
    );
    genLines.push(`explanation: ${g.explanation ?? "(none)"}`);
    if (g.sampleFormat) {
      genLines.push(`TARGET FORMAT (the source sample this was modelled on): stem ≈ ${g.sampleFormat.stemWords} words; each option ${g.sampleFormat.optMin}–${g.sampleFormat.optMax} words (e.g. "${g.sampleFormat.example}").`);
    }
  }
  genLines.push("</generated_questions>");

  const extra = args.extraInstructions?.trim()
    ? `\nUser instructions the questions were meant to follow:\n${args.extraInstructions.trim()}`
    : "";
  const avoid = args.negativePrompt?.trim()
    ? `\nThe questions were meant to avoid:\n${args.negativePrompt.trim()}`
    : "";

  const instruction = [
    `For EACH generated question (referenced by its GLOBAL index), judge in this order:`,
    "",
    "(a) CORRECTNESS & ANSWER↔EXPLANATION CONSISTENCY — re-derive the answer yourself (work the math/logic silently). Exactly one option may be defensibly correct. CRITICAL: `correct_index` MUST point to the option whose CONTENT is the genuinely correct answer, and the `explanation` MUST justify that SAME option — they must agree. If the marked answer is wrong, return verdict \"fix\" and set `correct_index` to the option whose text is correct (recount the options carefully — do not assume a position). If the answer and explanation disagree, that is an automatic \"fix\".",
    "    EXPLANATION HYGIENE — when you return an explanation, it MUST be CLEAN and FINAL: 1–3 confident sentences justifying the correct option by its content. It must contain NO reasoning scratch, NO hedging or self-correction ('Wait', 're-checking', 'recalculating', 'actually', 'fixing'), and NO references to option positions/indices/'layout'. If an existing explanation contains any such meta-talk, that ALONE is a \"fix\" — rewrite it cleanly.",
    `(b) CONCEPT MATCH & UNIQUENESS — it must test the SAME kind of concept as the source questions, and must NOT be a near-duplicate of any source question OR of another generated question in this set. If it is a duplicate or off-concept and cannot be salvaged by a light edit, return verdict \"reject\".`,
    `(c) OPTION & DISTRACTOR QUALITY — held to a HIGH bar. Require ALL of:`,
    "   • Exactly one defensibly-correct answer; every distractor is unambiguously WRONG yet TEMPTING — the kind a competent-but-mistaken candidate would actually pick, built from a SPECIFIC error (a named misconception, off-by-one, a skipped/duplicated step, a swapped formula, the wrong base/units, or a near-miss value). NEVER obvious filler, joke options, or absurd values.",
    "   • PARALLEL form: all four options share grammar, structure, length (within ~20% character count) and level of detail — the correct one must not stand out by length, specificity, or phrasing.",
    "   • Numeric distractors must cluster near the key and each correspond to an identifiable wrong method (forgot a step, wrong base, off by a factor) — not random far-off numbers.",
    "   • No giveaways: no distinctive stem word echoed only in the key; no absolute qualifiers (always/never/all/none) used only in distractors; no \"All/None of the above\".",
    "   • All four options are mutually DISTINCT — no two options expressing the same idea.",
    `   Also match the target difficulty (${args.difficulty}). If ANY option is implausible, obviously wrong, off-topic, non-parallel, a giveaway, or duplicative — return verdict \"fix\" and REWRITE the weak option(s) into strong misconception-based distractors (return all 4 in \`options\`, keeping the correct answer and updating \`correct_index\` if its position changed).`,
    "",
    "(d) STYLE & LENGTH MATCH — each question MUST match its TARGET FORMAT (shown per question when available; otherwise the SOURCE questions' style). Compare the generated option word-lengths to the target: if they are markedly SHORTER than the target (e.g. target options are ~12 words but the question has 4-word options) OR markedly LONGER (target is 2-word terms but the question has long phrases), that is a DEFECT — return verdict \"fix\" and rewrite the options to the target word-length (stay parallel, distinct, and misconception-based; update `correct_index` if order changed). Match the stem length to the target too. The generated set must mirror the source bank's mix of short and long questions — do NOT flatten everything to one length.",
    "",
    "Be demanding on (c) and (d): weak distractors and bloated/over-long options are the two most common defects — prefer \"fix\" over \"pass\" whenever the options could be stronger OR shorter-to-match-source.",
    "If a question passes all checks with no changes needed, return verdict \"pass\".",
    "When you return \"fix\", include ONLY the fields you changed (any of `question`, `options` (exactly 4 strings), `correct_index` (0..3), `explanation`); the rest are kept as-is.",
    "Always include a short `notes` string explaining your verdict.",
    extra,
    avoid,
    "",
    "Output a JSON array, one object per generated question, and NOTHING else:",
    `[{"index": <global index>, "verdict": "pass"|"fix"|"reject", "correct_index": <0..3, when fixing>, "question": "<when fixing>", "options": ["..4.."], "explanation": "<when fixing>", "notes": "<short reason>"}]`,
    "First character '[', last character ']'. No ``` fences, no prose.",
  ].filter(Boolean).join("\n");

  return [sourceLines.join("\n"), "", genLines.join("\n"), "", instruction].join("\n");
}

export function buildModifyPrompt(args: {
  mcq: {
    type: MCQType;
    topic: string;
    difficulty: Difficulty;
    question: string;
    options: string[];
    correct_index: number;
    explanation?: string | null;
    snippet?: { language: Language; code: string } | null;
  };
  instruction: string;
}): string {
  return [
    "You are editing a single multiple-choice question. Apply the user's requested change and return the corrected MCQ.",
    "",
    "Rules:",
    "- Apply ONLY what the instruction asks; preserve everything else.",
    "- Keep exactly 4 options and exactly one defensibly-correct answer.",
    "- correct_index is 0-based (0..3) and MUST point at the actually-correct option after your edit.",
    "- Keep factual accuracy: the correct option must be truly correct and distractors truly wrong. Do not invent APIs/syntax/values you are unsure of.",
    "- Refer to options by content in the explanation, never by position.",
    "- For code questions, keep snippet.code consistent with the answer.",
    "- Output ONLY a raw JSON object (no prose, no ``` fences) with keys: type, topic, difficulty, question, options (4 strings), correct_index, explanation, and snippet ({language, code}) when relevant.",
    "",
    `Instruction from the user:\n${args.instruction.trim()}`,
    "",
    "Current MCQ:",
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
