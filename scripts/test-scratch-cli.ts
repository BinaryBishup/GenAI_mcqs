// Exercise the Create-from-scratch chat pipeline WITHOUT the Anthropic API key:
// every model call is routed through the Claude Code CLI (`claude -p`), which
// bills the local Claude subscription instead. Uses the exact same prompt
// builders the backend routes use, so what we verify here is the real content:
//   1. interview  → scripted author answers → brief   (backend: sonnet tier)
//   2. samples    → 4 style varieties from the brief   (backend: sonnet tier)
//   3. generation → 5 questions from 2 approved styles (backend: sonnet tier)
//   npx tsx scripts/test-scratch-cli.ts [haiku|sonnet]
import { spawnSync } from "child_process";
import { writeFileSync } from "fs";

import { INTERVIEW_SYSTEM, SAMPLES_SYSTEM, buildInterviewUser, buildSamplesPrompt, sanitizeBrief } from "../lib/scratch";
import { SYSTEM_INSTRUCTIONS, buildUserPrompt } from "../lib/prompts";
import { extractJson } from "../lib/anthropic";
import type { ScratchBrief, ScratchChatMsg, ScratchVariant } from "../lib/types";

const MODEL = process.argv[2] || "sonnet";

function callClaude(system: string, prompt: string): string {
  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY; // force the CLI onto the subscription, not the (empty) API account
  const res = spawnSync(
    "claude",
    ["-p", "--model", MODEL, "--system-prompt", system, "--output-format", "text"],
    { input: prompt, encoding: "utf8", timeout: 360_000, maxBuffer: 32 * 1024 * 1024, env },
  );
  if (res.status !== 0) throw new Error(`claude -p failed (${res.status}): ${res.stderr?.slice(0, 500)}`);
  return (res.stdout ?? "").trim();
}

/** Keyword-routed canned author replies so the scripted interview stays coherent
 *  no matter which order the assistant asks its questions in. */
function answerFor(question: string, asked: Set<string>): string {
  const q = question.toLowerCase();
  if (/(diagram|image|visual|chart)/.test(q)) return "Yes, add diagrams where they genuinely help.";
  if (/(difficulty|how many|number of questions|count)/.test(q)) return "Medium difficulty, 10 questions.";
  if (/(apply|analys|style|code|snippet|kind)/.test(q)) return "A mix of application and analysis. No code snippets.";
  if (/(audience|who|experience|level|role)/.test(q)) return "Retail business analysts with 2-3 years of experience.";
  if (!asked.has("topic")) {
    asked.add("topic");
    return "I need questions on Excel pivot tables and lookup functions (VLOOKUP/XLOOKUP/INDEX-MATCH) for retail business analysts.";
  }
  return "Whatever you recommend is fine.";
}

async function main() {
  const out: Record<string, unknown> = { model: MODEL };

  // ---- 1. Interview ----
  console.log(`\n━━━ 1. INTERVIEW (model: ${MODEL}) ━━━`);
  const transcript: ScratchChatMsg[] = [];
  const asked = new Set<string>();
  let brief: ScratchBrief | null = null;
  for (let turn = 1; turn <= 8; turn++) {
    const raw = callClaude(INTERVIEW_SYSTEM, buildInterviewUser(transcript, []));
    const reply = JSON.parse(extractJson(raw));
    if (reply.action === "ready") {
      brief = sanitizeBrief(reply.brief);
      console.log(`\n[turn ${turn}] READY — summary: ${reply.summary}`);
      break;
    }
    const quick = Array.isArray(reply.quick_replies) && reply.quick_replies.length ? `   [chips: ${reply.quick_replies.join(" | ")}]` : "";
    console.log(`\n[turn ${turn}] ASSISTANT: ${reply.question}${quick}`);
    const answer = answerFor(String(reply.question), asked);
    console.log(`         AUTHOR: ${answer}`);
    transcript.push({ role: "assistant", text: String(reply.question) }, { role: "user", text: answer });
  }
  if (!brief) throw new Error("interview never reached a brief in 8 turns");
  console.log("\nBRIEF:", JSON.stringify(brief, null, 2));
  out.brief = brief;

  // ---- 2. Samples ----
  console.log(`\n━━━ 2. SAMPLE VARIETIES ━━━`);
  const rawSamples = callClaude(SAMPLES_SYSTEM, buildSamplesPrompt(brief, "Domain"));
  const variants = (JSON.parse(extractJson(rawSamples)) as ScratchVariant[]).filter(
    (v) => v?.mcq?.question && Array.isArray(v.mcq.options) && v.mcq.options.length === 4,
  );
  for (const [i, v] of variants.entries()) {
    console.log(`\n── Sample ${i + 1}: ${v.style_label} (${v.kind}) — ${v.style_summary}`);
    console.log(`Q: ${v.mcq.question}`);
    v.mcq.options.forEach((o, j) => console.log(`  ${"ABCD"[j]}) ${o}${j === v.mcq.correct_index ? "   ✓" : ""}`));
    console.log(`  Why: ${v.mcq.explanation}`);
  }
  if (variants.length < 3) throw new Error(`only ${variants.length} valid sample varieties`);
  out.variants = variants;

  // ---- 3. Full generation from 2 "approved" styles ----
  console.log(`\n━━━ 3. GENERATION (5 questions, exemplars = samples 1 & 2) ━━━`);
  const sel = variants.slice(0, 2);
  const exemplars = sel
    .map((v, i) => {
      const lines = [`Exemplar ${i + 1} — ${v.style_label}: ${v.style_summary}`, `Q: ${v.mcq.question}`];
      v.mcq.options.forEach((o, j) => lines.push(`  ${"ABCD"[j]}) ${o}${j === v.mcq.correct_index ? "   [correct]" : ""}`));
      return lines.join("\n");
    })
    .join("\n\n");
  const userPrompt = buildUserPrompt({
    count: 5,
    topic: brief.topic,
    difficulty: brief.difficulty,
    mcqType: brief.mcq_type,
    languages: brief.languages,
    samplesBlock: "",
    freeFormSamples: exemplars,
    extraInstructions: [
      brief.content_guidance,
      "APPROVED EXEMPLARS — the test author reviewed sample questions and approved the ones listed under 'Additional sample notes'. Spread the generated set across those approved styles, matching their framing, depth, candidate skill, and option format. Do NOT reuse their exact scenarios, entities, numbers, or wording.",
    ].join("\n\n"),
    negativePrompt: brief.negative_prompt,
    mode: "scratch",
    questionKinds: [...new Set(sel.map((v) => v.kind))],
  });
  const rawGen = callClaude(SYSTEM_INSTRUCTIONS, userPrompt);
  const mcqs = JSON.parse(extractJson(rawGen)) as Array<{ question: string; options: string[]; correct_index: number; explanation?: string }>;
  for (const [i, m] of mcqs.entries()) {
    console.log(`\n── Q${i + 1}: ${m.question}`);
    m.options.forEach((o, j) => console.log(`  ${"ABCD"[j]}) ${o}${j === m.correct_index ? "   ✓" : ""}`));
    console.log(`  Why: ${m.explanation}`);
  }
  out.generated = mcqs;

  const path = `/tmp/scratch-cli-test-${Date.now()}.json`;
  writeFileSync(path, JSON.stringify(out, null, 2));
  console.log(`\nSaved full output → ${path}`);
}

main().catch((e) => {
  console.error("FAILED:", e instanceof Error ? e.message : e);
  process.exit(1);
});
