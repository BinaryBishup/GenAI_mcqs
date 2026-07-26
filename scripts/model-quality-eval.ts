// Head-to-head MCQ quality eval: current models vs upgrade candidates,
// using the app's real production prompts, judged blind by a neutral model.
import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });
import Anthropic from "@anthropic-ai/sdk";
import { SYSTEM_INSTRUCTIONS, buildUserPrompt } from "../lib/prompts";
import { extractJson } from "../lib/anthropic";

const client = new Anthropic();
const JUDGE = "claude-opus-5"; // neutral — not in any matchup
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

async function generate(model: string): Promise<{ mcqs: MCQ[]; ms: number; out: number }> {
  const t0 = Date.now();
  const resp = await client.messages.create({
    model,
    max_tokens: 8000,
    system: SYSTEM_INSTRUCTIONS,
    messages: [{ role: "user", content: userPrompt }],
  });
  const text = resp.content.filter((b) => b.type === "text").map((b: any) => b.text).join("");
  const mcqs = JSON.parse(extractJson(text)) as MCQ[];
  return { mcqs, ms: Date.now() - t0, out: resp.usage.output_tokens };
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

async function judge(pairName: string, modelA: string, modelB: string, setA: MCQ[], setB: MCQ[]) {
  // randomize which model is shown as A vs B
  const flip = Math.random() < 0.5;
  const [shownA, shownB] = flip ? [setB, setA] : [setA, setB];
  const [nameA, nameB] = flip ? [modelB, modelA] : [modelA, modelB];

  const prompt = [
    `Two anonymous AI systems each generated ${COUNT} medium-difficulty MCQs on "${TOPIC}".`,
    `Evaluate both sets. For EVERY question, silently re-derive the answer yourself to check the marked key.`,
    `Score each set 1-10 on: (1) answer_key_correctness — are marked answers actually right, exactly one defensible answer; (2) distractor_quality — wrong options tempting, misconception-based, not filler; (3) parallel_form — options match in grammar/length, no giveaways; (4) stem_quality — clear, realistic, scenario-based stems; (5) difficulty_fit — genuinely medium for working backend developers.`,
    `Then pick an overall winner: "A", "B", or "tie". List any questions with an actually-WRONG answer key as key_errors.`,
    ``,
    renderSet("A", shownA),
    ``,
    renderSet("B", shownB),
    ``,
    `Output ONLY raw JSON: {"scores": {"A": {"answer_key_correctness": n, "distractor_quality": n, "parallel_form": n, "stem_quality": n, "difficulty_fit": n}, "B": {...}}, "key_errors": {"A": [q numbers], "B": [q numbers]}, "winner": "A"|"B"|"tie", "rationale": "2-3 sentences"}`,
  ].join("\n");

  const resp = await client.messages.create({
    model: JUDGE,
    max_tokens: 4000,
    messages: [{ role: "user", content: prompt }],
  });
  const text = resp.content.filter((b) => b.type === "text").map((b: any) => b.text).join("");
  const verdict = JSON.parse(extractJson(text));
  // decode blind labels back to model names
  const winner = verdict.winner === "tie" ? "tie" : verdict.winner === "A" ? nameA : nameB;
  return { pairName, nameA, nameB, verdict, winner };
}

const main = async () => {
  const models = ["claude-sonnet-4-6", "claude-sonnet-5", "claude-opus-4-7", "claude-opus-4-8"];
  const gens: Record<string, { mcqs: MCQ[]; ms: number; out: number }> = {};
  await Promise.all(
    models.map(async (m) => {
      gens[m] = await generate(m);
      console.log(`generated ${gens[m].mcqs.length} questions | ${m} | ${gens[m].ms}ms | ${gens[m].out} out-tokens`);
    }),
  );

  const results = await Promise.all([
    judge("BALANCED tier: sonnet-4-6 (current) vs sonnet-5 (new)", "claude-sonnet-4-6", "claude-sonnet-5", gens["claude-sonnet-4-6"].mcqs, gens["claude-sonnet-5"].mcqs),
    judge("HIGHEST tier: opus-4-7 (current) vs opus-4-8 (new)", "claude-opus-4-7", "claude-opus-4-8", gens["claude-opus-4-7"].mcqs, gens["claude-opus-4-8"].mcqs),
  ]);

  for (const r of results) {
    console.log("\n=== " + r.pairName + " ===");
    console.log(`blind labels: A=${r.nameA}  B=${r.nameB}`);
    for (const side of ["A", "B"] as const) {
      const s = r.verdict.scores[side];
      const total = Object.values(s as Record<string, number>).reduce((a: number, b) => a + Number(b), 0);
      console.log(`${side} (${side === "A" ? r.nameA : r.nameB}): key=${s.answer_key_correctness} distractors=${s.distractor_quality} parallel=${s.parallel_form} stems=${s.stem_quality} difficulty=${s.difficulty_fit} | total=${total}/50 | key errors: [${r.verdict.key_errors[side]}]`);
    }
    console.log(`WINNER: ${r.winner}`);
    console.log(`rationale: ${r.verdict.rationale}`);
  }
};

main();
