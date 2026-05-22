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

## Hard rules (structure)
- Output ONLY a JSON array. No prose, no markdown, no code fences.
- Each MCQ MUST have exactly 4 options.
- Questions must be NOVEL — paraphrase phrasing, change identifiers, change numeric values. Do not reproduce textbook questions verbatim.
- For type=code: the snippet must be self-contained and produce a single deterministic stdout that, after .strip(), equals options[correct_index] exactly.
- correct_index is a 0-based int (0..3).
- explanation is 1-2 sentences explaining why the correct answer is correct.

## Quality bar — the difference between a useful MCQ and a giveaway

**Option-length parity.** All four options MUST be roughly the same length — within ~20% character count of each other. A correct option that's noticeably longer, more detailed, or more qualified than its distractors telegraphs the answer. If the right answer naturally wants more words, pad the distractors with similar fluff so they match.

**Plausible distractors.** Every wrong option must be one a competent but mistaken test-taker would realistically pick. Build them from common misconceptions, off-by-one errors, swapped variables, mixed-up concepts, the answer to a related-but-different question, or near-miss numerics. Distractors that are obviously wrong on a glance waste the slot.

**Distractors cluster around the answer.** Wrong options should sit close enough to the correct one that the candidate has to actually think. For numeric answers, cluster around the right value (e.g. correct=42 → distractors 41, 43, 84 rather than 7, 1000, "banana"). For conceptual answers, distractors should share vocabulary and domain with the correct one.

**Parallel structure.** All options share grammar and form — all noun phrases, OR all complete sentences, OR all numeric, OR all code outputs. Same punctuation. Same level of detail. Don't mix "Yes" with "It depends on whether the input is sorted in non-decreasing order".

**No giveaway words.** Don't repeat distinctive words from the question stem only in the correct option. Don't use absolute qualifiers ("always", "never", "all", "none", "only") only in distractors — test-savvy candidates flag those as wrong by reflex.

**Avoid "All of the above" / "None of the above"** as either correct answer or distractor — they're lazy and break the distractor-similarity assumption.

**One question, one concept.** No compound stems ("X and which of the following Y?"). No double negatives. No questions whose answer depends on misreading the stem.

**Exactly one defensibly-correct answer.** If a domain expert could argue for two options, rewrite.

## For code MCQs specifically

- Distractors should be outputs a similar program could produce — off-by-one in iteration count, wrong on type coercion, wrong on operator precedence, off by an index, mutated-vs-returned confusion, wrong scope. Make them look like real bugs.
- Snippet must be short and self-contained — aim for ≤ 12 lines. No external imports beyond stdlib. No I/O beyond stdout.
- Output must be deterministic — no random, no time-based output, no dict-iteration-order-dependent output unless the answer accounts for it.
- Stay on the topic. If the question tests list slicing, don't also require knowing exception handling — single concept under test.

## Difficulty calibration

- **easy** — direct recall or one-step application of a definition or common syntax. "What does len([1,2,3]) return?"
- **medium** — short chain of reasoning: trace a small loop, pick the right method for a scenario, apply a rule with one twist. "What does this 5-line snippet print?"
- **hard** — edge cases, corner behaviour, multi-step trace, common gotchas that experienced practitioners trip on. "What does this snippet print when the input list is empty / contains duplicates / mutates during iteration?"

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
]`;

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
}): string {
  const langs = args.mcqType === "code" && args.languages.length > 0
    ? `Languages allowed: ${args.languages.join(", ")}. Pick one language per question; vary across the set.`
    : "";
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
