// 3-way blind MCQ quality eval: sonnet-5 vs opus-4-7 vs opus-5,
// using the app's real production prompts, judged blind by Fable 5 (neutral).
import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });
import Anthropic from "@anthropic-ai/sdk";
import { SYSTEM_INSTRUCTIONS, buildUserPrompt } from "../lib/prompts";
import { extractJson } from "../lib/anthropic";

const client = new Anthropic();
const JUDGE = "claude-fable-5"; // neutral — not a contestant
const CONTESTANTS = ["claude-sonnet-5", "claude-opus-4-7", "claude-opus-5"];
const TOPIC = "SQL query optimization and indexing for backend developers";
const COUNT = 5;

const userPrompt = buildUserPrompt({
  count: COUNT,
  topic: TOPIC,
  difficulty: "medium",
  mcqType: "general",
  languages: [],
  samplesBlock: "",
  mode: "scratch",
  questionKinds: ["application", "analysis"],
});

type MCQ = { question: string; options: string[]; correct_index: number; explanation?: string };

async function generate(model: string) {
  const t0 = Date.now();
  const resp = await client.messages.create({
    model,
    max_tokens: 8000,
    system: SYSTEM_INSTRUCTIONS,
    messages: [{ role: "user", content: userPrompt }],
  });
  const text = resp.content.filter((b) => b.type === "text").map((b: any) => b.text).join("");
  const mcqs = JSON.parse(extractJson(text)) as MCQ[];
  return { mcqs, ms: Date.now() - t0, inTok: resp.usage.input_tokens, outTok: resp.usage.output_tokens };
}

function renderSet(label: string, mcqs: MCQ[]): string {
  const lines = [`<set_${label}>`];
  mcqs.forEach((m, i) => {
    lines.push(`Q${i + 1}: ${m.question}`);
    m.options.forEach((o, j) => lines.push(`  ${j}${j === m.correct_index ? " [marked correct]" : ""}: ${o}`));
    lines.push(`  explanation: ${m.explanation ?? "(none)"}`);
  });
  lines.push(`</set_${label}>`);
  return lines.join("\n");
}

const main = async () => {
  const gens: Record<string, Awaited<ReturnType<typeof generate>>> = {};
  await Promise.all(
    CONTESTANTS.map(async (m) => {
      gens[m] = await generate(m);
      console.log(`generated | ${m} | ${gens[m].ms}ms | in/out ${gens[m].inTok}/${gens[m].outTok}`);
    }),
  );

  // shuffle contestants into blind labels A/B/C
  const shuffled = [...CONTESTANTS].sort(() => Math.random() - 0.5);
  const labels = ["A", "B", "C"];
  const labelToModel: Record<string, string> = {};
  shuffled.forEach((m, i) => (labelToModel[labels[i]] = m));

  const prompt = [
    `Three anonymous AI systems each generated ${COUNT} medium-difficulty MCQs on "${TOPIC}".`,
    `Evaluate all three sets. For EVERY question, silently re-derive the answer yourself to check the marked key.`,
    `Score each set 1-10 on: (1) answer_key_correctness — marked answers actually right, exactly one defensible answer; (2) distractor_quality — wrong options tempting, misconception-based, not filler; (3) parallel_form — options match in grammar/length, no giveaways; (4) stem_quality — clear, realistic, scenario-based stems; (5) difficulty_fit — genuinely medium for working backend developers.`,
    `Then rank the sets best to worst. List any questions with an actually-WRONG answer key as key_errors.`,
    ``,
    labels.map((l) => renderSet(l, gens[labelToModel[l]].mcqs)).join("\n\n"),
    ``,
    `Output ONLY raw JSON: {"scores": {"A": {"answer_key_correctness": n, "distractor_quality": n, "parallel_form": n, "stem_quality": n, "difficulty_fit": n}, "B": {...}, "C": {...}}, "key_errors": {"A": [q numbers], "B": [], "C": []}, "ranking": ["A"|"B"|"C" best-first], "rationale": "3-5 sentences comparing the three"}`,
  ].join("\n");

  const resp = await client.messages.create({
    model: JUDGE,
    max_tokens: 6000,
    messages: [{ role: "user", content: prompt }],
  });
  if ((resp.stop_reason as string) === "refusal") {
    console.log("JUDGE REFUSED — rerun with a different judge model");
    return;
  }
  const text = resp.content.filter((b) => b.type === "text").map((b: any) => b.text).join("");
  const v = JSON.parse(extractJson(text));

  console.log(`\nblind labels: ${labels.map((l) => `${l}=${labelToModel[l]}`).join("  ")}`);
  for (const l of labels) {
    const s = v.scores[l];
    const total = Object.values(s as Record<string, number>).reduce((a: number, b) => a + Number(b), 0);
    console.log(
      `${l} (${labelToModel[l]}): key=${s.answer_key_correctness} distractors=${s.distractor_quality} parallel=${s.parallel_form} stems=${s.stem_quality} difficulty=${s.difficulty_fit} | total=${total}/50 | key errors: [${v.key_errors[l]}]`,
    );
  }
  console.log(`RANKING (best first): ${v.ranking.map((l: string) => labelToModel[l]).join("  >  ")}`);
  console.log(`rationale: ${v.rationale}`);
};

main();
