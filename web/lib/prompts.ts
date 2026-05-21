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

## Hard rules
- Output ONLY a JSON array. No prose, no markdown, no code fences.
- Each MCQ MUST have exactly 4 options.
- Questions must be NOVEL — paraphrase phrasing, change identifiers, change numeric values. Do not reproduce textbook questions verbatim.
- For type=code: the snippet must be self-contained and produce a single deterministic stdout that, after .strip(), equals options[correct_index] exactly.
- correct_index is a 0-based int (0..3).
- explanation is 1-2 sentences explaining why the correct answer is correct.

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
}): string {
  const langs = args.mcqType === "code" && args.languages.length > 0
    ? `Languages allowed: ${args.languages.join(", ")}. Pick one language per question; vary across the set.`
    : "";
  return [
    args.samplesBlock,
    args.freeFormSamples ? `\nAdditional sample notes:\n${args.freeFormSamples}` : "",
    "",
    `Generate ${args.count} novel MCQs.`,
    `Topic: ${args.topic}`,
    `Difficulty: ${args.difficulty}`,
    `Type: ${args.mcqType}`,
    langs,
    "",
    "Output: a JSON array, exactly the schema in the system message. No prose.",
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
