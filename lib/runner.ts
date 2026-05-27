import { anthropic, extractJson } from "./anthropic";
import { supabaseAdmin } from "./supabase";
import { env } from "./env";
import { checkPlag } from "./plag";
import { verifyCodeMCQ, applyVerifyFix } from "./verify";
import {
  SYSTEM_INSTRUCTIONS,
  buildSamplesBlock,
  buildUserPrompt,
  buildRevampPrompt,
} from "./prompts";
import type {
  GenerateRequest,
  MCQ,
  StreamEvent,
} from "./types";
import { shortId } from "./utils";

type Emit = (evt: StreamEvent) => void;

/**
 * Orchestrate one MCQ run end-to-end.
 *  - Creates a `runs` row
 *  - Generates the draft with Claude (prompt-cached samples block)
 *  - Plag-checks each MCQ against pgvector + Exa
 *  - Revamps flagged MCQs (up to max_revamp_attempts)
 *  - Verifies code MCQs via Judge0
 *  - Persists everything to Supabase
 *  - Streams events through `emit`
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
      topic: req.topic,
      difficulty: req.difficulty,
      mcq_type: req.mcq_type,
      count: req.count,
      quality: req.quality,
      languages: req.languages,
      sample_file_ids: req.sample_files,
      samples_per_file: req.samples_per_file,
      max_revamp_attempts: req.max_revamp_attempts,
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
    // ---- 2. Load samples ---------------------------------------------------
    log({ type: "phase", data: { phase: "samples", message: "Loading samples..." } });
    const samples = await loadSamples(req);
    const samplesBlock = buildSamplesBlock(samples, req.count);

    // ---- 3. Generate draft -------------------------------------------------
    log({ type: "phase", data: { phase: "generate", message: `Generating with ${model}...` } });
    const draft = await generate(req, samplesBlock, model, (done, total) => {
      log({ type: "phase", data: { phase: "generate", message: `Generated ${done}/${total} with ${model}...` } });
    });
    log({ type: "generated", data: { count: draft.length } });

    // Persist initial drafts.
    await insertMCQs(runId, draft);

    for (let i = 0; i < draft.length; i++) {
      log({
        type: "question_start",
        data: { index: i, id: draft[i].id, question: draft[i] },
      });
    }

    // ---- 4. Plag-check + revamp loop ---------------------------------------
    await supa.from("runs").update({ status: "plagchecking" }).eq("id", runId);
    const mcqs = [...draft];
    await Promise.all(mcqs.map((_, idx) =>
      plagCheckWithRevamp(mcqs, idx, req, samplesBlock, model, emit, supa, runId, pendingWrites),
    ));

    // ---- 5. Code verify ----------------------------------------------------
    const codeIndices = mcqs.map((m, i) => (m.type === "code" ? i : -1)).filter((i) => i >= 0);
    const skipJudge0 = process.env.SKIP_JUDGE0 === "1" || process.env.SKIP_JUDGE0 === "true";
    if (codeIndices.length > 0 && skipJudge0) {
      log({
        type: "phase",
        data: {
          phase: "verify",
          message: `Skipping Judge0 verification for ${codeIndices.length} code MCQ(s) (SKIP_JUDGE0=1).`,
        },
      });
    } else if (codeIndices.length > 0) {
      await supa.from("runs").update({ status: "verifying" }).eq("id", runId);
      log({
        type: "phase",
        data: { phase: "verify", message: `Verifying ${codeIndices.length} code MCQ(s) via Judge0...` },
      });
      await Promise.all(
        codeIndices.map(async (i) => {
          const mcq = mcqs[i];
          log({
            type: "code_verify",
            data: { index: i, language: mcq.snippet?.language },
          });
          const outcome = await verifyCodeMCQ(mcq);
          await applyVerifyFix(mcq, outcome);
          await supa.from("mcqs").update({
            options: mcq.options,
            correct_index: mcq.correct_index,
            code_verified: mcq.code_verified,
            code_actual_output: mcq.code_actual_output,
            code_fix: mcq.code_fix,
          }).eq("run_id", runId).eq("index", i);
          log({
            type: "code_verified",
            data: { index: i, info: outcome },
          });
        }),
      );
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
        results[idx] = await generateBatch(req, samplesBlock, model, batchCounts[idx]);
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
async function generateBatch(
  req: GenerateRequest,
  samplesBlock: string,
  model: string,
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
  });

  // Sized for a single small batch — generous headroom so a batch never
  // truncates. Code MCQs cost ~1400 tokens each (Shape B = four fenced code
  // options + setup snippet); general MCQs ~500.
  const perMcq = req.mcq_type === "code" ? 1400 : 500;
  const maxTokens = Math.min(16000, Math.max(2000, count * perMcq + 800));

  let lastErr = "";
  let lastMeta = "";
  for (let attempt = 1; attempt <= 2; attempt++) {
    // Streaming avoids the 10-minute non-streaming SDK cap and lets long
    // batches re-assemble cleanly. The system block is prompt-cached so every
    // batch after the first reuses it cheaply.
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
      if (!Array.isArray(parsed)) throw new Error("batch did not return a JSON array");
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
          console.error(`[generateBatch] parse fail dumped to ${path} (${lastMeta})`);
        } catch {}
      }
    }
  }
  throw new Error(`batch parse failed after 2 attempts: ${lastErr}. ${lastMeta}`);
}

function normalizeMCQ(raw: any, i: number, req: GenerateRequest): MCQ {
  const id = typeof raw.id === "string" && raw.id.length ? raw.id : `${req.topic.slice(0, 6).replace(/\s+/g, "-").toLowerCase() || "mcq"}-${i}-${shortId()}`;
  const rawOptions = Array.isArray(raw.options) ? raw.options.map(String) : [];
  const rawCorrect = Math.max(0, Math.min(rawOptions.length - 1, Number(raw.correct_index ?? 0)));
  // The model has a strong positional bias toward correct_index=0; even with
  // explicit instructions to randomize, it ends up answer-at-A on most rows.
  // Randomize after parsing so the visible distribution is uniform regardless
  // of what the model emits.
  const { options, correct_index } = randomizeAnswerPosition(rawOptions, rawCorrect);
  return {
    id,
    type: raw.type === "code" ? "code" : raw.snippet ? "code" : req.mcq_type,
    topic: raw.topic ?? req.topic,
    difficulty: raw.difficulty ?? req.difficulty,
    question: String(raw.question ?? ""),
    options,
    correct_index,
    explanation: raw.explanation ?? null,
    snippet: raw.snippet?.code
      ? { language: raw.snippet.language ?? req.languages[0] ?? "python", code: String(raw.snippet.code) }
      : null,
    plag_status: "pending",
    plag_matches: [],
    plag_attempts: 0,
    code_verified: null,
    code_actual_output: null,
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

async function plagCheckWithRevamp(
  mcqs: MCQ[],
  index: number,
  req: GenerateRequest,
  samplesBlock: string,
  model: string,
  emit: Emit,
  supa: ReturnType<typeof supabaseAdmin>,
  runId: string,
  pending: Promise<unknown>[],
) {
  const log = (evt: StreamEvent) => emitAndLog(emit, supa, runId, evt, pending);
  let attempt = 0;
  const max = req.max_revamp_attempts;
  while (attempt <= max) {
    attempt += 1;
    mcqs[index].plag_attempts = attempt;
    log({ type: "plag_check", data: { index, attempt } });

    const verdict = await checkPlag(mcqs[index]);
    if (verdict.verdict === "unique") {
      mcqs[index].plag_status = attempt === 1 ? "unique" : "revamped";
      mcqs[index].plag_matches = verdict.matches.map((m) => m.url);
      await persistPlag(supa, runId, index, mcqs[index]);
      log({
        type: "plag_unique",
        data: { index, attempt, method: verdict.method },
      });
      return;
    }

    // flagged.
    mcqs[index].plag_status = "flagged";
    mcqs[index].plag_matches = verdict.matches.map((m) => m.url);
    await persistPlag(supa, runId, index, mcqs[index]);
    log({
      type: "plag_flagged",
      data: { index, attempt, matches: verdict.matches, method: verdict.method },
    });

    if (attempt > max) {
      mcqs[index].plag_status = "gave_up";
      await persistPlag(supa, runId, index, mcqs[index]);
      log({ type: "plag_gave_up", data: { index, attempt } });
      return;
    }

    // Revamp inline.
    log({ type: "revamping", data: { index, attempt } });
    const revamped = await revampOne(mcqs[index], verdict.matches, model);
    mcqs[index] = { ...mcqs[index], ...revamped, plag_status: "pending", plag_matches: [], plag_attempts: attempt };
    await supa.from("mcqs").update({
      question: mcqs[index].question,
      options: mcqs[index].options,
      correct_index: mcqs[index].correct_index,
      explanation: mcqs[index].explanation,
      snippet_language: mcqs[index].snippet?.language ?? null,
      snippet_code: mcqs[index].snippet?.code ?? null,
    }).eq("run_id", runId).eq("index", index);
  }
}

async function revampOne(
  mcq: MCQ,
  matches: { url: string; question: string }[],
  model: string,
): Promise<Partial<MCQ>> {
  const msg = await anthropic().messages.create({
    model,
    max_tokens: 1500,
    messages: [{
      role: "user",
      content: buildRevampPrompt({
        mcq: {
          type: mcq.type,
          topic: mcq.topic,
          difficulty: mcq.difficulty,
          question: mcq.question,
          options: mcq.options,
          correct_index: mcq.correct_index,
          snippet: mcq.snippet ? { language: mcq.snippet.language, code: mcq.snippet.code } : null,
        },
        matches,
      }),
    }],
  });
  const text = msg.content
    .flatMap((b) => (b.type === "text" ? [b.text] : []))
    .join("\n");
  const obj = JSON.parse(extractJson(text));
  return {
    question: String(obj.question ?? mcq.question),
    options: Array.isArray(obj.options) ? obj.options.map(String) : mcq.options,
    correct_index: Math.max(0, Math.min(3, Number(obj.correct_index ?? mcq.correct_index))),
    explanation: obj.explanation ?? mcq.explanation,
    snippet: obj.snippet?.code
      ? { language: obj.snippet.language ?? mcq.snippet?.language ?? "python", code: String(obj.snippet.code) }
      : mcq.snippet,
  };
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
  }));
  const { error } = await supa.from("mcqs").insert(rows);
  if (error) throw new Error(`mcq insert failed: ${error.message}`);
}

async function persistPlag(supa: ReturnType<typeof supabaseAdmin>, runId: string, index: number, mcq: MCQ) {
  await supa.from("mcqs").update({
    plag_status: mcq.plag_status,
    plag_matches: mcq.plag_matches,
    plag_attempts: mcq.plag_attempts,
  }).eq("run_id", runId).eq("index", index);
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
