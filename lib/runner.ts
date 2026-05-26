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
    const draft = await generate(req, samplesBlock, model);
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
  // Pull samples_per_file rows per source_file, filtered by difficulty when possible.
  const all: Awaited<ReturnType<typeof fetchPerFile>> = [];
  for (const f of req.sample_files) {
    const rows = await fetchPerFile(supa, f, req.difficulty, req.samples_per_file);
    all.push(...rows);
  }
  return all;
}

async function fetchPerFile(
  supa: ReturnType<typeof supabaseAdmin>,
  filename: string,
  difficulty: string,
  limit: number,
) {
  // Try the exact difficulty first; if too few rows come back, top up from any difficulty.
  const sel = "topic,difficulty,type,language,question,options,correct_index,code";
  const exact = await supa
    .from("samples")
    .select(sel)
    .eq("source_file", filename)
    .eq("difficulty", difficulty)
    .limit(limit);
  const got = exact.data ?? [];
  if (got.length >= limit) return got;
  const fill = await supa
    .from("samples")
    .select(sel)
    .eq("source_file", filename)
    .neq("difficulty", difficulty)
    .limit(limit - got.length);
  return [...got, ...(fill.data ?? [])];
}

async function generate(req: GenerateRequest, samplesBlock: string, model: string): Promise<MCQ[]> {
  const userPrompt = buildUserPrompt({
    count: req.count,
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

  // Scale output budget with requested count. Code MCQs cost more tokens
  // (snippet + explanation), so we use a generous per-MCQ budget. Claude 4.x
  // models support up to 64K output tokens; 16K is plenty here and keeps
  // streaming + cost predictable.
  const perMcq = req.mcq_type === "code" ? 600 : 400;
  const maxTokens = Math.min(16384, Math.max(2048, req.count * perMcq + 800));

  const msg = await anthropic().messages.create({
    model,
    max_tokens: maxTokens,
    system: [
      { type: "text", text: SYSTEM_INSTRUCTIONS, cache_control: { type: "ephemeral" } },
    ],
    messages: [{ role: "user", content: userPrompt }],
  });

  const text = msg.content
    .flatMap((b) => (b.type === "text" ? [b.text] : []))
    .join("\n");

  try {
    const parsed = JSON.parse(extractJson(text));
    if (!Array.isArray(parsed)) {
      throw new Error("generator did not return a JSON array");
    }
    return parsed.map((raw, i) => normalizeMCQ(raw, i, req));
  } catch (parseErr) {
    // Give a useful error so the run_events log captures what actually happened.
    const stopReason = msg.stop_reason ?? "unknown";
    const usage = msg.usage ? `in=${msg.usage.input_tokens} out=${msg.usage.output_tokens}` : "?";
    const truncated = stopReason === "max_tokens"
      ? ` — hit max_tokens (${maxTokens}). The generator was cut off mid-array. Try a smaller "Questions" count or a more concise prompt.`
      : "";
    const preview = text.length > 600 ? text.slice(0, 600) + "..." : text;
    const reason = parseErr instanceof Error ? parseErr.message : String(parseErr);
    throw new Error(
      `generation parse failed: ${reason}.${truncated} stop_reason=${stopReason} usage=${usage} response_preview=${JSON.stringify(preview)}`,
    );
  }
}

function normalizeMCQ(raw: any, i: number, req: GenerateRequest): MCQ {
  const id = typeof raw.id === "string" && raw.id.length ? raw.id : `${req.topic.slice(0, 6).replace(/\s+/g, "-").toLowerCase() || "mcq"}-${i}-${shortId()}`;
  return {
    id,
    type: raw.type === "code" ? "code" : raw.snippet ? "code" : req.mcq_type,
    topic: raw.topic ?? req.topic,
    difficulty: raw.difficulty ?? req.difficulty,
    question: String(raw.question ?? ""),
    options: Array.isArray(raw.options) ? raw.options.map(String) : [],
    correct_index: Math.max(0, Math.min(3, Number(raw.correct_index ?? 0))),
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
