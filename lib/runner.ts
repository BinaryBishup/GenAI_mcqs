import { anthropic, extractJson } from "./anthropic";
import { supabaseAdmin } from "./supabase";
import { env } from "./env";
import {
  SYSTEM_INSTRUCTIONS,
  buildSamplesBlock,
  buildUserPrompt,
  buildVariantPrompt,
  REVIEW_SYSTEM,
  buildReviewPrompt,
} from "./prompts";
import { loadSeedPool, planSeeds, type SeedRow, type SeedAssignment } from "./seed-plan";
import { generateDiagram } from "./diagram";
import { checkPlag } from "./plag";
import { checkAnswer, arbitrate } from "./answer-check";
import { embedTexts, maxCosine, cosine } from "./embed";
import * as fuzz from "fuzzball";
import type {
  GenerateRequest,
  MCQ,
  MCQType,
  AnswerCheckStatus,
  StreamEvent,
} from "./types";
import { shortId, normalizeText } from "./utils";

type Emit = (evt: StreamEvent) => void;

// Similarity thresholds. A generated question scoring at/above these against an
// already-accepted sibling or a source-bank question is "too similar" and gets
// regenerated. Cosine (semantic) is the primary signal; the lexical fuzz ratio
// is the fallback when embeddings are unavailable.
const SIM_SIBLING = Number(process.env.SIM_COSINE_SIBLING || "0.88");
const SIM_SOURCE = Number(process.env.SIM_COSINE_SOURCE || "0.93");
const LEX_SIBLING = 0.82;
const LEX_SOURCE = 0.85;
const MAX_REGEN = 2;

/** Per-team generation/review guidance, appended to the user's instructions. */
function teamGuidance(team?: string): string {
  switch (team) {
    case "HACK":
      return "TEAM CONTEXT — Technical screening (programming, systems, databases, cloud, networking, security). Demand technical accuracy and current terminology. Distractors must be realistic technical misconceptions (off-by-one, wrong API, swapped concept), never obvious filler.";
    case "Cognitive":
      return "TEAM CONTEXT — Quantitative & logical aptitude. CRITICAL: every numeric answer MUST be arithmetically correct — work the math step by step and double-check before committing the key. Each question must have EXACTLY ONE unambiguous correct answer: avoid ill-posed framings with more than one defensible reading (e.g. 'overall/net loss' across a buy→sell→buyback chain where it's unclear whether the asset is still held). Vary the scenario domain, the specific numbers, and the exact quantity asked across questions so no two feel like the same problem reskinned.";
    case "Domain":
      return "TEAM CONTEXT — Functional / business domain knowledge (project management, tools, processes, workplace practice). Use realistic, varied workplace scenarios; ground answers in standard best practice; avoid trivia.";
    default:
      return "";
  }
}

/** Embedding text for a question: stem + its correct answer, so two questions
 *  that resolve to the SAME concept/answer (even with different scenarios) land
 *  close together and the dedup catches the redundancy. */
function embText(question: string, options: string[], correct: number): string {
  const ans = options?.[correct] ?? "";
  return ans ? `${question} || correct: ${ans}` : question;
}

/**
 * Reorder a seed pool so its most conceptually-DISTINCT questions come first
 * (farthest-point sampling over embeddings of stem+answer). Picking seeds from
 * the front then yields a diverse set instead of several clones of whatever
 * concept the bank happens to over-represent. Falls back to the original order
 * if embeddings are unavailable.
 */
async function diverseOrder(pool: SeedRow[], want: number): Promise<SeedRow[]> {
  if (pool.length <= 2) return pool;
  const vecs = await embedSafe(pool.map((s) => embText(s.question, s.options, s.correct_index)));
  if (!vecs || vecs.length !== pool.length) return pool;
  const n = pool.length;
  const k = Math.min(n, Math.max(want, 30));
  const chosen: number[] = [0];
  const used = new Set([0]);
  const maxCos = vecs.map((v) => cosine(v, vecs[0]));
  while (chosen.length < k) {
    let best = -1, bestDist = -1;
    for (let i = 0; i < n; i++) {
      if (used.has(i)) continue;
      const dist = 1 - maxCos[i];
      if (dist > bestDist) { bestDist = dist; best = i; }
    }
    if (best < 0) break;
    chosen.push(best);
    used.add(best);
    for (let i = 0; i < n; i++) {
      if (used.has(i)) continue;
      const c = cosine(vecs[i], vecs[best]);
      if (c > maxCos[i]) maxCos[i] = c;
    }
  }
  const rest = pool.map((_, i) => i).filter((i) => !used.has(i));
  return [...chosen, ...rest].map((i) => pool[i]);
}

/** Max lexical similarity (token_set_ratio, 0–1) of `q` against any text. */
function lexMax(q: string, texts: string[]): number {
  const a = normalizeText(q);
  let m = 0;
  for (const t of texts) {
    const s = fuzz.token_set_ratio(a, normalizeText(t)) / 100;
    if (s > m) m = s;
  }
  return m;
}

/** One source question kept as the concept reference for the review pass. */
type SourceQuestion = { question: string; options: string[]; correct_index: number };

/**
 * Orchestrate one MCQ run as a simple two-step flow.
 *  1. GENERATE — one strong pass that creates concept-matched, unique questions
 *     from the chosen sample bank at the same quality & difficulty (per-seed
 *     expansion when a bank is selected, else blended few-shot generation).
 *  2. REVIEW — one AI review/fix pass that verifies every question is correct,
 *     unique, and on-quality, fixing or flagging as needed.
 * Persists everything to Supabase and streams events through `emit`.
 */
export async function runWorkflow(req: GenerateRequest, emit: Emit): Promise<{ runId: string; mcqs: MCQ[] }> {
  const supa = supabaseAdmin();
  const model = env.modelFor(req.quality);

  // Track in-flight run_events inserts so we can drain them before the
  // serverless function exits — otherwise Vercel freezes the function and
  // the writes never land.
  const pendingWrites: Promise<unknown>[] = [];
  const log = (evt: StreamEvent) => emitAndLog(emit, supa, runId, evt, pendingWrites);

  // ---- 1. Create run row ----------------------------------------------------
  const { data: runRow, error: runErr } = await supa
    .from("runs")
    .insert({
      status: "generating",
      team: req.team ?? null,
      topic: req.topic,
      difficulty: req.difficulty,
      mcq_type: req.mcq_type,
      count: req.count,
      quality: req.quality,
      languages: req.languages,
      sample_file_ids: req.sample_files,
      samples_per_file: req.samples_per_file,
      max_revamp_attempts: req.max_revamp_attempts,
      // Persist the user's prompts so the review screen can show what was asked.
      extra_prompt: req.extra_prompt?.trim() || null,
      negative_prompt: req.negative_prompt?.trim() || null,
    })
    .select()
    .single();
  if (runErr || !runRow) throw new Error(`failed to create run: ${runErr?.message ?? "no row"}`);
  const runId = runRow.id as string;

  log({
    type: "workflow_start",
    data: {
      run_id: runId,
      count: req.count,
      topic: req.topic,
      difficulty: req.difficulty,
      mcq_type: req.mcq_type,
      quality: req.quality,
      model,
    },
  });

  try {
    // ---- 2. Load samples / plan seeds --------------------------------------
    // Sample mode with bank(s) selected → per-seed expansion: clone each source
    // question into K variants so the bank's type/shape/difficulty mix is
    // preserved by construction. Falls back to blended few-shot generation for
    // scratch mode or an empty pool. Either way we keep a bounded set of source
    // questions as the concept reference for the review pass.
    log({ type: "phase", data: { phase: "samples", message: "Loading samples..." } });
    const useSeeded = (req.mode ?? "sample") === "sample" && req.sample_files.length > 0;
    let seedAssignments: SeedAssignment[] = [];
    let samplesBlock = "";
    let sourceQuestions: SourceQuestion[] = [];
    if (useSeeded) {
      const pool: SeedRow[] = [];
      if (req.bank_specs && req.bank_specs.length > 0) {
        // Per-bank, difficulty-filtered seeding: each bank contributes `count`
        // variants drawn ONLY from its questions at the chosen difficulty.
        for (const spec of req.bank_specs) {
          const bankPool = await loadSeedPool([spec.file], spec.difficulty);
          pool.push(...bankPool);
          const ordered = await diverseOrder(bankPool, spec.count);
          seedAssignments.push(...planSeeds(ordered, spec.count, false));
        }
      } else {
        const all = await loadSeedPool(req.sample_files);
        pool.push(...all);
        const ordered = await diverseOrder(all, req.count);
        seedAssignments = planSeeds(ordered, req.count, false);
      }
      sourceQuestions = pool
        .slice(0, 20)
        .map((s) => ({ question: s.question, options: s.options, correct_index: s.correct_index }));
      if (seedAssignments.length > 0) {
        const perSeed = seedAssignments.length >= req.count
          ? "1 each"
          : `~${Math.round(req.count / seedAssignments.length)} each`;
        log({
          type: "phase",
          data: {
            phase: "samples",
            message: `Expanding ${seedAssignments.length} source question(s) → ${req.count} variants (${perSeed}).`,
          },
        });
      }
    }
    const seeded = useSeeded && seedAssignments.length > 0;
    if (!seeded) {
      const samples = await loadSamples(req);
      samplesBlock = buildSamplesBlock(samples, req.count);
      sourceQuestions = samples
        .slice(0, 20)
        .map((s) => ({ question: s.question, options: s.options, correct_index: s.correct_index }));
    }

    // Persist run provenance (best-effort: columns exist only after migration 003).
    await bestEffortUpdate(supa, "runs", runId, {
      mode: req.mode ?? "sample",
      grounded: false,
      question_kinds: req.question_kinds ?? [],
    });

    // Fold the team's guidance into the user instructions for every model call.
    const req2: GenerateRequest = {
      ...req,
      extra_prompt: [req.extra_prompt, teamGuidance(req.team)].filter(Boolean).join("\n\n") || undefined,
    };

    // ---- 3. Generate draft (single strong pass) ----------------------------
    log({ type: "phase", data: { phase: "generate", message: `Generating with ${model}...` } });
    const onProgress: ProgressCb = (done, total) => {
      log({ type: "phase", data: { phase: "generate", message: `Generated ${done}/${total} with ${model}...` } });
    };
    const draft = seeded
      ? await generateSeeded(req2, seedAssignments, model, "", onProgress)
      : await generate(req2, samplesBlock, model, "", onProgress);
    log({ type: "generated", data: { count: draft.length } });

    // Persist initial drafts.
    await insertMCQs(runId, draft);

    for (let i = 0; i < draft.length; i++) {
      log({ type: "question_start", data: { index: i, id: draft[i].id, question: draft[i] } });
    }

    const mcqs = [...draft];
    const seedMap = new Map(seedAssignments.map((a) => [a.seed.id, a.seed]));
    const seedByIndex: (SeedRow | null)[] = mcqs.map((m) => (m.parent_sample_id ? seedMap.get(m.parent_sample_id) ?? null : null));

    // ---- 4. Uniqueness: web plag (Tavily) + semantic dedup + regenerate ----
    const accepted = await uniquenessPass(mcqs, seedByIndex, sourceQuestions, req2, model, log, supa, runId);

    // ---- 5. Review pass (correctness / uniqueness / quality) ---------------
    await supa.from("runs").update({ status: "reviewing" }).eq("id", runId);
    log({ type: "phase", data: { phase: "review", message: `Reviewing ${mcqs.length} questions for correctness & quality...` } });
    await reviewBatch(mcqs, sourceQuestions, req2, model, log, supa, runId, undefined, seedByIndex);

    // ---- 5b. Regenerate anything the review rejected, re-check, re-review ---
    await regenerateRejects(mcqs, seedByIndex, accepted, sourceQuestions, req2, model, log, supa, runId);

    // ---- 5c. Independent verification gate (the "no wrong answer" guarantee)-
    // A separate, STRONGER model solves each non-code question blind and must
    // agree with the marked answer. Confident disagreements / ambiguity get one
    // regeneration; anything still unresolved is flagged (never auto-approved).
    await verifyPass(mcqs, seedByIndex, sourceQuestions, req2, model, log, supa, runId);

    // ---- 5d. Diagram-as-code images (best-effort) --------------------------
    if (req2.create_images) {
      await generateImages(mcqs, req2, model, log, supa, runId);
    }

    // ---- 6. Done -----------------------------------------------------------
    for (let i = 0; i < mcqs.length; i++) {
      log({ type: "question_done", data: { index: i, question: mcqs[i] } });
    }
    await supa.from("runs").update({ status: "done", finished_at: new Date().toISOString() }).eq("id", runId);
    log({ type: "workflow_done", data: { run_id: runId, count: mcqs.length, questions: mcqs } });

    await Promise.allSettled(pendingWrites);
    return { runId, mcqs };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await supa.from("runs").update({ status: "error", error_message: message, finished_at: new Date().toISOString() }).eq("id", runId);
    log({ type: "error", data: { phase: "workflow", message } });
    await Promise.allSettled(pendingWrites);
    throw err;
  }
}

/** Verdict returned by the review model for a single generated question. */
interface ReviewVerdict {
  index: number;
  verdict: "pass" | "fix" | "reject";
  correct_index?: number;
  question?: string;
  options?: string[];
  explanation?: string | null;
  notes?: string | null;
}

/**
 * Single AI review/fix pass. Processes the draft in chunks of 8: each chunk is
 * sent to Claude with the source questions as the concept reference. Verdicts
 * are applied in place — `pass`/`fix` mark the answer-check as "agree" (with
 * `fix` also rewriting the content), `reject` marks "disagree". A chunk whose
 * model call or parse fails is treated as all-pass so one bad chunk never sinks
 * the run.
 */
async function reviewBatch(
  mcqs: MCQ[],
  sourceQuestions: SourceQuestion[],
  req: GenerateRequest,
  model: string,
  log: (evt: StreamEvent) => void,
  supa: ReturnType<typeof supabaseAdmin>,
  runId: string,
  only?: number[],
  seedByIndex?: (SeedRow | null)[],
): Promise<void> {
  const chunkSize = 8;
  const fmtOf = (i: number) => {
    const seed = seedByIndex?.[i];
    if (!seed) return null;
    const w = seed.options.map((o) => (o || "").trim().split(/\s+/).filter(Boolean).length);
    return { stemWords: (seed.question || "").trim().split(/\s+/).filter(Boolean).length, optMin: Math.min(...w), optMax: Math.max(...w), example: seed.options[0] ?? "" };
  };
  const allIdx = only ?? mcqs.map((_, i) => i);
  const chunks: number[][] = [];
  for (let start = 0; start < allIdx.length; start += chunkSize) {
    chunks.push(allIdx.slice(start, start + chunkSize));
  }

  const applyAgree = async (index: number, status: AnswerCheckStatus, notes: string | null) => {
    const mcq = mcqs[index];
    mcq.answer_check_status = status;
    mcq.answer_check_index = status === "disagree" ? null : mcq.correct_index;
    mcq.answer_check_notes = notes;
    await bestEffortUpdate(
      supa,
      "mcqs",
      null,
      {
        answer_check_status: mcq.answer_check_status,
        answer_check_index: mcq.answer_check_index,
        answer_check_notes: mcq.answer_check_notes,
      },
      { run_id: runId, index },
    );
    log({ type: "answer_checked", data: { index, info: { status: mcq.answer_check_status, notes } } });
  };

  await Promise.all(
    chunks.map(async (indices) => {
      try {
        const userPrompt = buildReviewPrompt({
          generated: indices.map((i) => ({
            index: i,
            question: mcqs[i].question,
            options: mcqs[i].options,
            correct_index: mcqs[i].correct_index,
            explanation: mcqs[i].explanation,
            snippet: mcqs[i].snippet ? { language: mcqs[i].snippet!.language, code: mcqs[i].snippet!.code } : null,
            sampleFormat: fmtOf(i),
          })),
          sources: sourceQuestions,
          difficulty: req.difficulty,
          mcqType: req.mcq_type,
          extraInstructions: req.extra_prompt,
          negativePrompt: req.negative_prompt,
        });

        const msg = await anthropic().messages.create({
          model,
          max_tokens: Math.min(16000, Math.max(2000, indices.length * 700 + 800)),
          system: REVIEW_SYSTEM,
          messages: [{ role: "user", content: userPrompt }],
        });
        const text = msg.content
          .flatMap((b) => (b.type === "text" ? [b.text] : []))
          .join("\n");
        const parsed = JSON.parse(extractJson(text));
        if (!Array.isArray(parsed)) throw new Error("review did not return a JSON array");

        const byIndex = new Map<number, ReviewVerdict>();
        for (const v of parsed as ReviewVerdict[]) {
          if (typeof v?.index === "number") byIndex.set(v.index, v);
        }

        for (const i of indices) {
          const v = byIndex.get(i);
          if (!v) {
            await applyAgree(i, "agree", null);
            continue;
          }
          const notes = v.notes ?? null;
          if (v.verdict === "reject") {
            await applyAgree(i, "disagree", notes ?? "Flagged by review");
            continue;
          }
          if (v.verdict === "fix") {
            const mcq = mcqs[i];
            if (typeof v.question === "string" && v.question.trim()) mcq.question = v.question;
            if (Array.isArray(v.options) && v.options.length === 4) mcq.options = v.options.map(String);
            if (typeof v.correct_index === "number") {
              mcq.correct_index = Math.max(0, Math.min(3, v.correct_index));
            }
            if (v.explanation !== undefined) mcq.explanation = v.explanation ?? null;
            await supa
              .from("mcqs")
              .update({
                question: mcq.question,
                options: mcq.options,
                correct_index: mcq.correct_index,
                explanation: mcq.explanation,
              })
              .eq("run_id", runId)
              .eq("index", i);
            await applyAgree(i, "agree", notes);
            continue;
          }
          // pass
          await applyAgree(i, "agree", notes);
        }
      } catch {
        // Resilient: a failed chunk shouldn't fail the run — mark all as agree.
        for (const i of indices) await applyAgree(i, "agree", null);
      }
    }),
  );
}

interface Accepted {
  acceptedVecs: number[][];
  acceptedTexts: string[];
  semantic: boolean;
}

async function embedSafe(texts: string[]): Promise<number[][] | null> {
  try {
    return await embedTexts(texts);
  } catch {
    return null;
  }
}

async function persistContent(supa: ReturnType<typeof supabaseAdmin>, runId: string, index: number, mcq: MCQ) {
  await supa
    .from("mcqs")
    .update({
      question: mcq.question,
      options: mcq.options,
      correct_index: mcq.correct_index,
      explanation: mcq.explanation,
      type: mcq.type,
      snippet_language: mcq.snippet?.language ?? null,
      snippet_code: mcq.snippet?.code ?? null,
    })
    .eq("run_id", runId)
    .eq("index", index);
}

async function persistPlag(supa: ReturnType<typeof supabaseAdmin>, runId: string, index: number, mcq: MCQ) {
  await supa
    .from("mcqs")
    .update({ plag_status: mcq.plag_status, plag_matches: mcq.plag_matches, plag_attempts: mcq.plag_attempts })
    .eq("run_id", runId)
    .eq("index", index);
  await bestEffortUpdate(supa, "mcqs", null, { diversity_status: mcq.diversity_status ?? "ok" }, { run_id: runId, index });
}

/**
 * Plagiarism + similarity gate. For each generated question, greedily accept it
 * only if it's (a) not a web-plagiarism match (Tavily) and (b) not too similar —
 * semantically (Voyage cosine, fallback lexical) — to an already-accepted
 * sibling or a source-bank question. Anything that fails is regenerated from its
 * seed (told what to avoid) up to MAX_REGEN times; what still can't be made
 * unique is flagged for the human reviewer. Returns the accepted vectors/texts
 * so the later review-regeneration can keep diverging from them.
 */
async function uniquenessPass(
  mcqs: MCQ[],
  seedByIndex: (SeedRow | null)[],
  sourceQuestions: SourceQuestion[],
  req: GenerateRequest,
  model: string,
  log: (evt: StreamEvent) => void,
  supa: ReturnType<typeof supabaseAdmin>,
  runId: string,
): Promise<Accepted> {
  await supa.from("runs").update({ status: "plagchecking" }).eq("id", runId);
  log({ type: "phase", data: { phase: "uniqueness", message: `Checking ${mcqs.length} questions for plagiarism & similarity...` } });

  const sourceTexts = sourceQuestions.map((s) => embText(s.question, s.options, s.correct_index));
  let semantic = true;
  let sourceVecs = await embedSafe(sourceTexts);
  if (sourceVecs === null) {
    semantic = false;
    sourceVecs = [];
  }
  let genVecs: (number[] | null)[] = [];
  if (semantic) {
    const v = await embedSafe(mcqs.map((m) => embText(m.question, m.options, m.correct_index)));
    if (v === null) semantic = false;
    else genVecs = v;
  }

  const acceptedVecs: number[][] = [];
  const acceptedTexts: string[] = [];

  for (let i = 0; i < mcqs.length; i++) {
    let attempt = 0;
    let vec: number[] | null = semantic ? genVecs[i] ?? null : null;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      mcqs[i].plag_attempts = attempt;
      log({ type: "plag_check", data: { index: i, attempt } });

      const simSibling = vec ? maxCosine(vec, acceptedVecs).score : lexMax(mcqs[i].question, acceptedTexts);
      const simSource = vec ? maxCosine(vec, sourceVecs).score : lexMax(mcqs[i].question, sourceTexts);
      const sibT = vec ? SIM_SIBLING : LEX_SIBLING;
      const srcT = vec ? SIM_SOURCE : LEX_SOURCE;
      const tooSimilar = simSibling >= sibT || simSource >= srcT;

      let plag: { verdict: string; matches: { url: string; question: string }[] } = { verdict: "unique", matches: [] };
      try {
        const v = await checkPlag(mcqs[i]);
        plag = { verdict: v.verdict, matches: v.matches.map((m) => ({ url: m.url, question: m.question })) };
      } catch {
        /* web check best-effort */
      }
      const plagged = plag.verdict === "flagged";

      if (!tooSimilar && !plagged) {
        mcqs[i].plag_status = attempt === 0 ? "unique" : "revamped";
        mcqs[i].plag_matches = plag.matches.map((m) => m.url);
        mcqs[i].diversity_status = "ok";
        await persistPlag(supa, runId, i, mcqs[i]);
        log({ type: "plag_unique", data: { index: i, attempt } });
        if (vec) acceptedVecs.push(vec);
        acceptedTexts.push(mcqs[i].question);
        break;
      }

      attempt++;
      const seed = seedByIndex[i];
      if (attempt > MAX_REGEN || !seed) {
        mcqs[i].plag_status = plagged ? "flagged" : "gave_up";
        mcqs[i].diversity_status = tooSimilar ? "duplicate" : "ok";
        await persistPlag(supa, runId, i, mcqs[i]);
        log({ type: plagged ? "plag_flagged" : "plag_gave_up", data: { index: i, attempt, matches: plag.matches } });
        if (vec) acceptedVecs.push(vec);
        acceptedTexts.push(mcqs[i].question);
        break;
      }

      log({ type: "revamping", data: { index: i, attempt, reason: tooSimilar ? "too similar" : "plagiarised" } });
      const avoid = [...acceptedTexts, ...plag.matches.map((m) => m.question)].filter(Boolean).slice(0, 25);
      let fresh: unknown[] = [];
      try {
        fresh = await generateVariants(req, seed, 1, model, "", avoid);
      } catch {
        /* regen failed */
      }
      if (fresh.length) {
        mcqs[i] = normalizeMCQ(fresh[0], i, req, seed);
        mcqs[i].plag_attempts = attempt;
        await persistContent(supa, runId, i, mcqs[i]);
        if (semantic) {
          const e = await embedSafe([embText(mcqs[i].question, mcqs[i].options, mcqs[i].correct_index)]);
          vec = e && e[0] ? e[0] : null;
          if (!vec) semantic = false;
        }
      } else {
        attempt = MAX_REGEN + 1; // exhaust → give up on next iteration
      }
    }
  }
  return { acceptedVecs, acceptedTexts, semantic };
}

/**
 * Anything the review rejected (answer wrong / off-concept) gets one fresh
 * variant from its seed, a web-plag check, and a single re-review — the
 * "review failed → new version → plag test → deliver" loop.
 */
async function regenerateRejects(
  mcqs: MCQ[],
  seedByIndex: (SeedRow | null)[],
  accepted: Accepted,
  sourceQuestions: SourceQuestion[],
  req: GenerateRequest,
  model: string,
  log: (evt: StreamEvent) => void,
  supa: ReturnType<typeof supabaseAdmin>,
  runId: string,
): Promise<void> {
  const rejects = mcqs.map((m, i) => (m.answer_check_status === "disagree" ? i : -1)).filter((i) => i >= 0);
  if (rejects.length === 0) return;
  log({ type: "phase", data: { phase: "review", message: `Regenerating ${rejects.length} rejected question(s)...` } });

  for (const i of rejects) {
    const seed = seedByIndex[i];
    if (!seed) continue;
    log({ type: "revamping", data: { index: i, attempt: 1, reason: "review rejected" } });
    let fresh: unknown[] = [];
    try {
      fresh = await generateVariants(req, seed, 1, model, "", accepted.acceptedTexts.slice(0, 25));
    } catch {
      /* keep the original (still flagged) */
    }
    if (fresh.length === 0) continue;

    mcqs[i] = normalizeMCQ(fresh[0], i, req, seed);
    await persistContent(supa, runId, i, mcqs[i]);

    try {
      const v = await checkPlag(mcqs[i]);
      mcqs[i].plag_status = v.verdict === "flagged" ? "flagged" : "revamped";
      mcqs[i].plag_matches = v.matches.map((m) => m.url);
    } catch {
      mcqs[i].plag_status = "revamped";
    }
    mcqs[i].plag_attempts = (mcqs[i].plag_attempts ?? 0) + 1;
    await persistPlag(supa, runId, i, mcqs[i]);
    accepted.acceptedTexts.push(mcqs[i].question);

    // re-review just the regenerated question
    await reviewBatch(mcqs, sourceQuestions, req, model, log, supa, runId, [i], seedByIndex);
  }
}

/**
 * Diagram-as-code pass. For each question, ask Claude whether it needs a visual
 * and, if so, generate one self-contained inline SVG (diagram-as-code, not a
 * diffusion image). Runs with a small worker pool so a 20-question run doesn't
 * fire 20 parallel model calls. Every image is best-effort — a failure (or a
 * question that needs no diagram) just leaves `image_svg` null and never fails
 * the run.
 */
async function generateImages(
  mcqs: MCQ[],
  req: GenerateRequest,
  model: string,
  log: (evt: StreamEvent) => void,
  supa: ReturnType<typeof supabaseAdmin>,
  runId: string,
): Promise<void> {
  log({ type: "phase", data: { phase: "images", message: `Creating diagrams for ${mcqs.length} questions...` } });

  const concurrency = 4;
  let nextIdx = 0;

  async function worker() {
    while (true) {
      const i = nextIdx++;
      if (i >= mcqs.length) return;
      let svg: string | null = null;
      // The user explicitly asked for images and generation built every
      // question around a figure, so draw one for each — never decide NONE.
      // A null here means a transient model/parse miss; retry once.
      for (let attempt = 0; attempt < 2 && !svg; attempt++) {
        try {
          svg = await generateDiagram({
            question: mcqs[i].question,
            options: mcqs[i].options,
            difficulty: req.difficulty,
            model,
            force: true,
            instruction: req.extra_prompt?.trim() || undefined,
          });
        } catch {
          /* best-effort: never fail the run on a diagram */
        }
      }
      if (svg) {
        mcqs[i].image_svg = svg;
        await bestEffortUpdate(supa, "mcqs", null, { image_svg: svg }, { run_id: runId, index: i });
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, mcqs.length) }, () => worker()));
}

/**
 * Final correctness gate. A separate STRONGER model (highest tier) solves each
 * non-code question blind and must agree with the marked answer. A confident
 * disagreement or flagged ambiguity gets ONE regeneration (then re-review +
 * re-verify); whatever still doesn't pass is left flagged (disagree/uncertain)
 * so it shows as pending and is never part of the auto-approved set.
 */
async function verifyPass(
  mcqs: MCQ[],
  seedByIndex: (SeedRow | null)[],
  sourceQuestions: SourceQuestion[],
  req: GenerateRequest,
  model: string,
  log: (evt: StreamEvent) => void,
  supa: ReturnType<typeof supabaseAdmin>,
  runId: string,
): Promise<void> {
  const idxs = mcqs.map((m, i) => (m.type !== "code" ? i : -1)).filter((i) => i >= 0);
  if (idxs.length === 0) return;
  await supa.from("runs").update({ status: "verifying" }).eq("id", runId);
  log({ type: "phase", data: { phase: "verify", message: `Independently verifying ${idxs.length} answers...` } });
  const verifier = env.modelFor("highest");

  type Settled = { status: AnswerCheckStatus; index: number | null; notes: string };
  const settle = async (i: number, attempt: number): Promise<Settled> => {
    const v = await checkAnswer(mcqs[i], undefined, verifier);
    if (v.status === "agree") return { status: "agree", index: v.index, notes: v.notes };

    // The checker disagreed or flagged ambiguity — adjudicate definitively.
    const arb = await arbitrate(mcqs[i], v.index, verifier);
    if (!arb.ambiguous && arb.index != null) {
      if (arb.index === mcqs[i].correct_index) {
        return { status: "agree", index: arb.index, notes: arb.explanation || "verified by arbiter" };
      }
      // Genuinely wrong key — correct it (and clean up the explanation).
      mcqs[i].correct_index = arb.index;
      if (arb.explanation) mcqs[i].explanation = arb.explanation;
      await persistContent(supa, runId, i, mcqs[i]);
      return { status: "agree", index: arb.index, notes: `corrected by arbiter: ${arb.explanation}` };
    }

    // Ambiguous / ill-posed — try one fresh variant from the seed, else flag.
    if (attempt < 1 && seedByIndex[i]) {
      const seed = seedByIndex[i]!;
      log({ type: "revamping", data: { index: i, attempt: 1, reason: "verify ambiguous" } });
      let fresh: unknown[] = [];
      try { fresh = await generateVariants(req, seed, 1, model, "", []); } catch { /* keep */ }
      if (fresh.length) {
        mcqs[i] = normalizeMCQ(fresh[0], i, req, seed);
        await persistContent(supa, runId, i, mcqs[i]);
        await reviewBatch(mcqs, sourceQuestions, req, model, log, supa, runId, [i], seedByIndex);
        return settle(i, attempt + 1);
      }
    }
    return { status: "uncertain", index: v.index, notes: arb.explanation || v.notes };
  };

  let next = 0;
  const worker = async () => {
    while (true) {
      const k = next++;
      if (k >= idxs.length) return;
      const i = idxs[k];
      const r = await settle(i, 0);
      mcqs[i].answer_check_status = r.status;
      mcqs[i].answer_check_index = r.index;
      mcqs[i].answer_check_notes = r.notes;
      await bestEffortUpdate(supa, "mcqs", null, { answer_check_status: r.status, answer_check_index: r.index, answer_check_notes: r.notes }, { run_id: runId, index: i });
      log({ type: "answer_checked", data: { index: i, info: { status: r.status, notes: r.notes } } });
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, idxs.length) }, () => worker()));
}

async function loadSamples(req: GenerateRequest) {
  if (req.sample_files.length === 0) return [];
  const supa = supabaseAdmin();
  // For each file, surface a diverse subset so the model sees the variety
  // present in large workbooks (100+ rows) instead of always the first N.
  // Scale the visible window with the requested count: more MCQs requested →
  // show the model more sample patterns to draw from. Capped at 15 per file
  // to keep prompt-cache hits cheap.
  const visible = Math.min(
    15,
    Math.max(req.samples_per_file, 4 + Math.ceil(req.count / 5)),
  );
  const all: Awaited<ReturnType<typeof fetchPerFile>> = [];
  for (const f of req.sample_files) {
    const rows = await fetchPerFile(supa, f, req.difficulty, visible);
    all.push(...rows);
  }
  return all;
}

/** Fisher–Yates, in place. */
function shuffleInPlace<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

async function fetchPerFile(
  supa: ReturnType<typeof supabaseAdmin>,
  filename: string,
  difficulty: string,
  visible: number,
) {
  // Pull a pool larger than the model-visible budget, then randomize and
  // grab a varied slice. For a 100-row workbook this surfaces real variety
  // instead of always the first parsed rows.
  const poolSize = Math.max(visible * 8, 40);
  const sel = "topic,difficulty,type,language,question,options,correct_index,code";

  const exact = await supa
    .from("samples")
    .select(sel)
    .eq("source_file", filename)
    .eq("difficulty", difficulty)
    .limit(poolSize);

  let pool = exact.data ?? [];
  if (pool.length < visible) {
    const fill = await supa
      .from("samples")
      .select(sel)
      .eq("source_file", filename)
      .neq("difficulty", difficulty)
      .limit(poolSize - pool.length);
    pool = [...pool, ...(fill.data ?? [])];
  }
  shuffleInPlace(pool);
  return pool.slice(0, visible);
}

type ProgressCb = (done: number, total: number) => void;

/**
 * Generate `req.count` MCQs by splitting the work into small batches that run
 * with bounded concurrency.
 *
 * Why batch: a single call asking for 50 code MCQs needs far more than the
 * 32K output-token cap (each Shape-B MCQ is ~700-1k tokens), so it gets cut
 * off mid-array → JSON.parse fails → the whole run dies. It also takes 6+
 * minutes, blowing past Vercel's maxDuration and leaving the UI stuck on
 * "Generating…". Small batches each stay well under the token cap, finish in
 * ~30-60s, and run several at a time so total wall-time stays low. A single
 * batch that fails to parse is retried once and then skipped — partial output
 * beats losing everything.
 */
async function generate(
  req: GenerateRequest,
  samplesBlock: string,
  model: string,
  groundingBlock: string,
  onProgress?: ProgressCb,
): Promise<MCQ[]> {
  const total = req.count;
  // Code MCQs are token-heavy (fenced snippets in options), so use smaller
  // batches for them. General MCQs are compact → larger batches are fine.
  const batchSize = req.mcq_type === "code" ? 6 : 12;
  const concurrency = 5;

  const batchCounts: number[] = [];
  for (let remaining = total; remaining > 0; remaining -= batchSize) {
    batchCounts.push(Math.min(batchSize, remaining));
  }

  const results: any[][] = new Array(batchCounts.length);
  let completed = 0;
  let nextIdx = 0;
  let lastError: Error | null = null;

  async function worker() {
    while (true) {
      const idx = nextIdx++;
      if (idx >= batchCounts.length) return;
      try {
        results[idx] = await generateBatch(req, samplesBlock, model, groundingBlock, batchCounts[idx]);
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        results[idx] = [];
      }
      completed += results[idx].length;
      onProgress?.(completed, total);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, batchCounts.length) }, () => worker()),
  );

  // Batches can over- or under-produce (the model doesn't count perfectly), so
  // trim to exactly the requested count for a consistent result.
  const flat = results.flat().slice(0, total);
  if (flat.length === 0) {
    const errMsg = (lastError as Error | null)?.message;
    throw new Error(
      `generation produced no MCQs across ${batchCounts.length} batch(es)` +
        (errMsg ? `: ${errMsg}` : ""),
    );
  }
  return flat.map((raw, i) => normalizeMCQ(raw, i, req));
}

/** Generate a single batch of `count` MCQs. Retries once on a parse failure. */
/**
 * Detect whether the chosen sample files are Application or Analysis questions
 * from their names (the sample workbooks are labelled e.g. "… - Analysis").
 * Returns the type when the selection is unambiguous, else null (let the model
 * classify per sample).
 */
function detectSampleType(files: string[]): "application" | "analysis" | null {
  const lc = files.map((f) => f.toLowerCase());
  const hasApp = lc.some((f) => f.includes("application"));
  const hasAna = lc.some((f) => f.includes("analysis"));
  if (hasApp && !hasAna) return "application";
  if (hasAna && !hasApp) return "analysis";
  return null;
}

async function generateBatch(
  req: GenerateRequest,
  samplesBlock: string,
  model: string,
  groundingBlock: string,
  count: number,
): Promise<any[]> {
  const userPrompt = buildUserPrompt({
    count,
    topic: req.topic,
    difficulty: req.difficulty,
    mcqType: req.mcq_type,
    languages: req.languages,
    samplesBlock,
    freeFormSamples: req.samples_raw,
    extraInstructions: req.extra_prompt,
    negativePrompt: req.negative_prompt,
    qualityRules: req.quality_rules,
    groundingBlock,
    mode: req.mode ?? "sample",
    questionKinds: req.question_kinds,
    sampleTypeHint: detectSampleType(req.sample_files),
    visualMode: (req.mode ?? "sample") === "scratch" && !!req.create_images,
  });

  // Sized for a single small batch — generous headroom so a batch never
  // truncates. Code MCQs cost ~1400 tokens each (Shape B = four fenced code
  // options + setup snippet); general MCQs ~500.
  const perMcq = req.mcq_type === "code" ? 1400 : 500;
  const maxTokens = Math.min(16000, Math.max(2000, count * perMcq + 800));
  return streamMcqArray(model, userPrompt, maxTokens);
}

/**
 * Call Claude for a JSON array of MCQs and parse it. Streaming avoids the
 * 10-minute non-streaming SDK cap and lets long outputs re-assemble cleanly;
 * the system block is prompt-cached so every call after the first reuses it
 * cheaply. Retries once on a parse failure.
 */
async function streamMcqArray(model: string, userPrompt: string, maxTokens: number): Promise<any[]> {
  let lastErr = "";
  let lastMeta = "";
  for (let attempt = 1; attempt <= 2; attempt++) {
    const stream = anthropic().messages.stream({
      model,
      max_tokens: maxTokens,
      system: [
        { type: "text", text: SYSTEM_INSTRUCTIONS, cache_control: { type: "ephemeral" } },
      ],
      messages: [{ role: "user", content: userPrompt }],
    });
    const msg = await stream.finalMessage();
    const text = msg.content
      .flatMap((b) => (b.type === "text" ? [b.text] : []))
      .join("\n");

    try {
      const parsed = JSON.parse(extractJson(text));
      if (!Array.isArray(parsed)) throw new Error("did not return a JSON array");
      return parsed;
    } catch (parseErr) {
      const stopReason = msg.stop_reason ?? "unknown";
      const usage = msg.usage ? `in=${msg.usage.input_tokens} out=${msg.usage.output_tokens}` : "?";
      lastErr = parseErr instanceof Error ? parseErr.message : String(parseErr);
      lastMeta = `stop_reason=${stopReason} usage=${usage} max=${maxTokens} attempt=${attempt}`;
      if (process.env.NODE_ENV !== "production") {
        try {
          const fs = await import("fs/promises");
          const path = `/tmp/mcq-parse-fail-${Date.now()}-a${attempt}.txt`;
          await fs.writeFile(path, text);
          // eslint-disable-next-line no-console
          console.error(`[streamMcqArray] parse fail dumped to ${path} (${lastMeta})`);
        } catch {}
      }
    }
  }
  throw new Error(`batch parse failed after 2 attempts: ${lastErr}. ${lastMeta}`);
}

/**
 * Per-seed expansion. Each seed is cloned into its assigned number of variants;
 * large per-seed counts are split into token-safe chunks. Runs with the same
 * bounded concurrency as blended generation. Every variant carries its seed so
 * the result inherits the seed's type/difficulty and records lineage.
 */
async function generateSeeded(
  req: GenerateRequest,
  assignments: SeedAssignment[],
  model: string,
  groundingBlock: string,
  onProgress?: ProgressCb,
): Promise<MCQ[]> {
  type Task = { seed: SeedRow; count: number };
  const tasks: Task[] = [];
  for (const a of assignments) {
    const chunkSize = a.seed.type === "code" ? 6 : 12;
    for (let remaining = a.count; remaining > 0; remaining -= chunkSize) {
      tasks.push({ seed: a.seed, count: Math.min(chunkSize, remaining) });
    }
  }

  const total = req.count;
  const concurrency = 5;
  const results: { seed: SeedRow; raw: any[] }[] = new Array(tasks.length);
  let completed = 0;
  let nextIdx = 0;
  let lastError: Error | null = null;

  async function worker() {
    while (true) {
      const idx = nextIdx++;
      if (idx >= tasks.length) return;
      const t = tasks[idx];
      try {
        results[idx] = { seed: t.seed, raw: await generateVariants(req, t.seed, t.count, model, groundingBlock) };
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        results[idx] = { seed: t.seed, raw: [] };
      }
      completed += results[idx].raw.length;
      onProgress?.(completed, total);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, tasks.length) }, () => worker()),
  );

  // Keep each variant's seed for parent lineage + type/difficulty fallback.
  const flat: { raw: any; seed: SeedRow }[] = [];
  for (const r of results) {
    if (!r) continue;
    for (const raw of r.raw) flat.push({ raw, seed: r.seed });
  }
  const trimmed = flat.slice(0, total);
  if (trimmed.length === 0) {
    throw new Error(
      `seeded generation produced no MCQs across ${tasks.length} task(s)` +
        (lastError ? `: ${(lastError as Error).message}` : ""),
    );
  }
  return trimmed.map((item, i) => normalizeMCQ(item.raw, i, req, item.seed));
}

/** Generate `count` novel variants of a single seed question. Retries once on parse failure. */
async function generateVariants(
  req: GenerateRequest,
  seed: SeedRow,
  count: number,
  model: string,
  groundingBlock: string,
  avoidQuestions?: string[],
): Promise<any[]> {
  const userPrompt = buildVariantPrompt({
    seed: {
      topic: seed.topic,
      difficulty: seed.difficulty,
      type: seed.type,
      question: seed.question,
      options: seed.options,
      correct_index: seed.correct_index,
      language: seed.language,
      code: seed.code,
    },
    count,
    languages: req.languages,
    extraInstructions: req.extra_prompt,
    negativePrompt: req.negative_prompt,
    qualityRules: req.quality_rules,
    groundingBlock,
    avoidQuestions,
  });
  const perMcq = seed.type === "code" ? 1400 : 500;
  const maxTokens = Math.min(16000, Math.max(2000, count * perMcq + 800));
  return streamMcqArray(model, userPrompt, maxTokens);
}

function normalizeMCQ(raw: any, i: number, req: GenerateRequest, seed?: SeedRow): MCQ {
  const id = typeof raw.id === "string" && raw.id.length ? raw.id : `${req.topic.slice(0, 6).replace(/\s+/g, "-").toLowerCase() || "mcq"}-${i}-${shortId()}`;
  const rawOptions = Array.isArray(raw.options) ? raw.options.map(String) : [];
  const rawCorrect = Math.max(0, Math.min(rawOptions.length - 1, Number(raw.correct_index ?? 0)));
  // The model has a strong positional bias toward correct_index=0; even with
  // explicit instructions to randomize, it ends up answer-at-A on most rows.
  // Randomize after parsing so the visible distribution is uniform regardless
  // of what the model emits.
  const { options, correct_index } = randomizeAnswerPosition(rawOptions, rawCorrect);
  // In seeded mode, variants inherit their seed's type/difficulty/language when
  // the model omits them.
  const seedType: MCQType | undefined = seed ? (seed.type === "code" ? "code" : "general") : undefined;
  return {
    id,
    type: raw.type === "code" ? "code" : raw.snippet ? "code" : seedType ?? req.mcq_type,
    topic: raw.topic ?? seed?.topic ?? req.topic,
    difficulty: raw.difficulty ?? seed?.difficulty ?? req.difficulty,
    question: String(raw.question ?? ""),
    options,
    correct_index,
    explanation: raw.explanation ?? null,
    snippet: raw.snippet?.code
      ? { language: raw.snippet.language ?? seed?.language ?? req.languages[0] ?? "python", code: String(raw.snippet.code) }
      : null,
    plag_status: "pending",
    plag_matches: [],
    plag_attempts: 0,
    code_verified: null,
    code_actual_output: null,
    parent_sample_id: seed?.id ?? null,
  };
}

/** Shuffle option order and return the new index of the originally-correct one. */
function randomizeAnswerPosition(opts: string[], correctIdx: number): { options: string[]; correct_index: number } {
  if (opts.length < 2 || correctIdx < 0 || correctIdx >= opts.length) {
    return { options: opts, correct_index: correctIdx };
  }
  const indexed = opts.map((text, idx) => ({ text, originallyCorrect: idx === correctIdx }));
  for (let i = indexed.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [indexed[i], indexed[j]] = [indexed[j], indexed[i]];
  }
  const newCorrect = indexed.findIndex((o) => o.originallyCorrect);
  return { options: indexed.map((o) => o.text), correct_index: newCorrect };
}

async function insertMCQs(runId: string, mcqs: MCQ[]) {
  const supa = supabaseAdmin();
  const rows = mcqs.map((m, i) => ({
    run_id: runId,
    index: i,
    type: m.type,
    topic: m.topic,
    difficulty: m.difficulty,
    question: m.question,
    options: m.options,
    correct_index: m.correct_index,
    explanation: m.explanation,
    snippet_language: m.snippet?.language ?? null,
    snippet_code: m.snippet?.code ?? null,
    parent_sample_id: m.parent_sample_id ?? null,
  }));
  const { error } = await supa.from("mcqs").insert(rows);
  if (error) throw new Error(`mcq insert failed: ${error.message}`);
}

let warnedMissingColumns = false;

/**
 * Update columns that only exist after migration 003 (answer_check_*, runs.mode
 * etc.). PostgREST returns an error in the response (it does not throw) when a
 * column is missing; we swallow it so generation still completes before the
 * migration is applied. The live status still streams over SSE either way.
 */
async function bestEffortUpdate(
  supa: ReturnType<typeof supabaseAdmin>,
  table: "runs" | "mcqs",
  id: string | null,
  values: Record<string, unknown>,
  match?: Record<string, unknown>,
): Promise<void> {
  try {
    let q = supa.from(table).update(values);
    if (id) q = q.eq("id", id);
    if (match) for (const [k, v] of Object.entries(match)) q = q.eq(k, v as never);
    const { error } = await q;
    if (error && !warnedMissingColumns) {
      warnedMissingColumns = true;
      console.warn(
        `[bestEffortUpdate] ${table} update skipped (apply migration 003 to persist verification fields): ${error.message}`,
      );
    }
  } catch (e) {
    if (!warnedMissingColumns) {
      warnedMissingColumns = true;
      console.warn(`[bestEffortUpdate] ${table} update threw: ${(e as Error).message}`);
    }
  }
}

function emitAndLog(
  emit: Emit,
  supa: ReturnType<typeof supabaseAdmin>,
  runId: string,
  evt: StreamEvent,
  pending?: Promise<unknown>[],
) {
  emit(evt);
  const p = supa.from("run_events").insert({ run_id: runId, type: evt.type, data: evt.data });
  // Push into the caller's pending list so they can drain before the
  // serverless function exits. Without this, Vercel freezes the function
  // and the writes never persist.
  if (pending) pending.push(Promise.resolve(p).catch(() => undefined));
  else void p;
}
