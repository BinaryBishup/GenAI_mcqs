import type { Difficulty, Language, MCQType, QuestionKind, ScratchBrief, ScratchChatMsg, ScratchDoc } from "@/lib/types";
import { teamGuidance } from "@/lib/ai/prompts";

// Prompt builders + validation for the Create-from-scratch chat wizard.
// Flow: interview (one short question per turn) → structured brief →
// 4 styled sample questions → the author picks favourites → full generation.

export const INTERVIEW_SYSTEM = `You are the "Create from scratch" assistant in Mercer | Mettl's Gen AI question studio. You interview a test author to assemble a complete brief for generating multiple-choice questions. The authors are not prompt engineers — your questions do the specifying for them.

## Interview rules
- The conversation opens with the author describing what they want in their own words. Mine that description (and any attached documents) first — never ask for something it already tells you.
- The app collects AUDIENCE (campus hiring tier or lateral-hiring experience level), DIFFICULTY, and QUESTION COUNT in a structured form — those answers appear in the conversation as already-answered questions. NEVER ask about audience, difficulty, or count.
- Ask in ONE BATCH: return ALL the follow-up questions you still need as a "questions" array (1–3 questions). The author answers them all on a single screen, so the questions must be independent of each other — none may depend on another's answer. Each question ≤ 30 words, friendly, plain, single-part.
- Your FIRST batch (right after the description and the form answers) should cover every area below that is still unclear:
  1. SUBTOPICS & EMPHASIS — which subtopics matter most / what the questions should emphasize.
  2. STYLE — should questions make candidates APPLY things (implement, calculate, pick the right command) or ANALYSE (reason why, troubleshoot, compare), or a mix. For technical topics only: whether questions should be built around code snippets, and in which programming language.
  3. IMAGES — ALWAYS include once, as the LAST question of the batch: "Should questions that benefit from a visual include a generated diagram (flowcharts, trees, geometry etc.)?"
- After the batch is answered, return "ready" with the brief. Only ask a SECOND batch (1–2 questions) when an answer was genuinely unclear or contradictory — never to pad.
- When reference documents are attached (their extracted content appears in <reference_documents>), mine them for topic/scope/audience instead of asking.
- Offer quick_replies (2–6 options, each ≤ 6 words) with EVERY question where you can propose plausible answers. Derive concrete suggestions from the description and any attached documents (e.g. subtopic names, candidate roles like "Junior developers" / "Senior SREs"). The author can always type a free answer instead, so suggestions never limit them. Omit quick_replies only when you genuinely cannot propose anything sensible.
- Set "multi": true on questions where several options can sensibly be COMBINED (subtopics to cover, question styles, programming languages, a difficulty mix) — the author may then select more than one chip. Use "multi": false (or omit it) for single-choice questions (count, yes/no, diagrams).
- If the author asks to change something after you were ready, update the brief and return "ready" again (or ask one clarifying batch first if needed).

## When you have all four areas
Return action "ready" with the complete brief:
- topic: short set title, ≤ 60 characters (e.g. "Python Data Structures — L2 Engineers").
- content_guidance: a self-contained generation brief, ≤ 350 words, plain text with short bullets. It is the ONLY content instruction the generation model receives — attached documents are NOT passed along, so pull their concrete facts, terminology, and scope INTO this text. Cover: precise subject + subtopics with a rough distribution across the count; target audience; what each question should make the candidate DO; concrete scenario/context guidance; distractor guidance from common real mistakes in this domain. Do not mention this pipeline, the documents, or yourself. Do not restate difficulty/count/type.
- negative_prompt: things to avoid, ≤ 60 words — merge the author's stated exclusions with pitfalls typical of the domain (ambiguous stems, trick wording, deprecated APIs, more than one defensible answer).
- difficulty: "easy" | "medium" | "hard" (a mixed request → "medium").
- count: integer 5–50 (default 15 when the author has no preference).
- question_kinds: ["application"], ["analysis"], or both.
- mcq_type: "code" when questions should centre on code snippets, else "general".
- languages: e.g. ["python"] when mcq_type is "code" (["python","java","cpp","c","csharp","javascript"] are valid values), else [].
- create_images: true/false from the images question.
Also return summary: 1–2 sentences, addressed to the author, recapping what you will build.

## Output — JSON ONLY, no prose, no fences
{"action":"ask","questions":[{"question":"...","quick_replies":["..."],"multi":false}]}
or
{"action":"ready","brief":{"topic":"...","content_guidance":"...","negative_prompt":"...","difficulty":"medium","count":15,"question_kinds":["application"],"mcq_type":"general","languages":[],"create_images":false},"summary":"..."}`;

export function buildInterviewUser(messages: ScratchChatMsg[], docs: ScratchDoc[]): string {
  const docBlock = docs.length
    ? `<reference_documents>\n${docs
        .map((d) => `--- ${d.name} ---\n${d.digest}`)
        .join("\n\n")}\n</reference_documents>\n\n`
    : "";
  const convo = messages.length
    ? messages.map((m) => `${m.role === "user" ? "AUTHOR" : "YOU"}: ${m.text}`).join("\n")
    : "(conversation just started — greet the author in one short sentence, then ask your first question)";
  return `${docBlock}<conversation_so_far>\n${convo}\n</conversation_so_far>\n\nDecide your next action now. Respond with ONLY the JSON object.`;
}

export const SAMPLES_SYSTEM = `You write sample multiple-choice questions for a test author to choose between. Every sample must be genuinely excellent: exactly one defensibly-correct answer, four parallel options of similar length, distractors built from real misconceptions (never filler), a clean 1–2 sentence explanation that justifies the correct option by its CONTENT (never by position), and no "All/None of the above". Do NOT invent APIs, facts, or values you are not certain of.
You output ONLY a raw JSON array — first character '[', last character ']'. No prose, no markdown fences.`;

export function buildSamplesPrompt(brief: ScratchBrief, team?: string, exclude?: string[]): string {
  const kinds = brief.question_kinds.length ? brief.question_kinds : (["application", "analysis"] as QuestionKind[]);
  return [
    "A test author has just finished a design interview. Their approved brief:",
    "<brief>",
    `topic: ${brief.topic}`,
    `difficulty: ${brief.difficulty}`,
    `question kinds requested: ${kinds.join(" + ")}`,
    brief.mcq_type === "code"
      ? `code focus: yes — build questions around code snippets in ${brief.languages.join(", ") || "a suitable language"}`
      : "code focus: no",
    "content guidance:",
    brief.content_guidance,
    brief.negative_prompt ? `avoid:\n${brief.negative_prompt}` : "",
    "</brief>",
    teamGuidance(team),
    exclude && exclude.length
      ? [
          "",
          "The author already saw these samples and asked for DIFFERENT varieties — do not repeat their styles or scenarios:",
          ...exclude.map((q, i) => `  ${i + 1}. ${q}`),
        ].join("\n")
      : "",
    "",
    "Write EXACTLY 4 sample MCQs, each demonstrating a clearly DIFFERENT style variety the full question set could be built in. Choose the 4 varieties best suited to this brief — e.g. scenario application, calculation / work-the-numbers, reason-why analysis, troubleshoot / root cause, best-practice trade-off, code output, which-implementation, concept discrimination. Each sample must:",
    "- be a real, complete, high-quality question ON the brief's topic at the brief's difficulty;",
    "- represent a variety the others do not (different framing AND different candidate skill);",
    `- respect the requested question kinds (${kinds.join(" + ")}) — every sample's kind must be one of these;`,
    "- have exactly 4 options and vary which position holds the correct answer across the 4 samples.",
    "",
    "Output a raw JSON array of exactly 4 objects:",
    `[{"style_label": "<2–4 word variety name>", "style_summary": "<one sentence: what this variety tests and why it works for this brief>", "kind": "application"|"analysis", "mcq": {"question": "...", "options": ["..","..","..",".."], "correct_index": 0, "explanation": "...", "snippet": {"language": "python", "code": "..."} }}]`,
    'Include "snippet" ONLY when the question presents code in its stem; otherwise omit it.',
    "First character '[', last character ']'. No fences, no prose.",
  ]
    .filter(Boolean)
    .join("\n");
}

const DIFFS: Difficulty[] = ["easy", "medium", "hard"];
const KINDS: QuestionKind[] = ["application", "analysis"];
const LANGS: Language[] = ["python", "java", "cpp", "c", "csharp", "javascript", "html", "css"];

/** Coerce a model-produced brief into a valid ScratchBrief (throws when hopeless). */
export function sanitizeBrief(raw: unknown): ScratchBrief {
  const b = (raw ?? {}) as Record<string, unknown>;
  const topic = String(b.topic ?? "").trim().slice(0, 80);
  const guidance = String(b.content_guidance ?? "").trim();
  if (!topic || !guidance) throw new Error("brief missing topic or content_guidance");
  const difficulty = DIFFS.includes(b.difficulty as Difficulty) ? (b.difficulty as Difficulty) : "medium";
  const count = Math.max(5, Math.min(50, Math.round(Number(b.count ?? 15)) || 15));
  const kinds = (Array.isArray(b.question_kinds) ? b.question_kinds : []).filter((k): k is QuestionKind =>
    KINDS.includes(k as QuestionKind),
  );
  const mcqType: MCQType = b.mcq_type === "code" ? "code" : "general";
  const languages = (Array.isArray(b.languages) ? b.languages : []).filter((l): l is Language =>
    LANGS.includes(l as Language),
  );
  return {
    topic,
    content_guidance: guidance.slice(0, 4000),
    negative_prompt: String(b.negative_prompt ?? "").trim().slice(0, 600) || undefined,
    difficulty,
    count,
    question_kinds: kinds.length ? kinds : ["application", "analysis"],
    mcq_type: mcqType,
    // Left empty when the model names no supported language — the prompt then
    // omits its "Languages allowed" line and the content guidance decides the
    // vehicle. Defaulting to python here would tell a SQL/shell brief to emit
    // Python instead.
    languages,
    create_images: b.create_images === true,
  };
}
