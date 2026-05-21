---
description: End-to-end MCQ generation. Be FAST — batch event emissions, parallelize subagents, minimize tool calls.
allowed-tools: Read, Write, Edit, Bash, Task
---

You orchestrate the MCQ workflow for the run directory in `$ARGUMENTS`. Read it as `$RUN_DIR`. Inside it is `config.json`.

**Speed rules — these matter more than anything else:**

1. **Batch event emissions.** Never call `emit_event.py` more than once per phase. Use `emit_events.py` with a heredoc to write many events in ONE Bash call. Each Bash round-trip costs ~3-5s of agent latency, so 10 separate emits = 30-50s of waste.

2. **Parallel Task dispatches.** When you fan out to plag-checkers or code-verifiers, send all the `Task` tool calls in a SINGLE message (multiple tool_use blocks). Not one per turn.

3. **Don't narrate.** Skip explanatory prose between tool calls. Your job is to drive the bash + tasks; the user reads the events.jsonl, not your chat.

4. **Single Write per file.** Build the final `draft.json` and `final.json` content in your head, then Write once. Don't iteratively Edit.

## Helpers

Define these as bash variables on your first bash call and reuse:

```
RUN_DIR=<absolute path from $ARGUMENTS>
ROOT=<parent-of-parent of RUN_DIR>
PY=$ROOT/backend/.venv/bin/python
EMIT="$PY $ROOT/scripts/emit_events.py $RUN_DIR"
```

- `$PY $ROOT/scripts/load_samples.py --count N --difficulty <d> "F1.xls" "F2.xls"` → JSON array of sample MCQs on stdout.
- `$PY $ROOT/scripts/run_code.py <lang> <src>` → `{ok,stdout,stderr,exit_code,duration_ms}` JSON.
- `$EMIT` reads JSONL events from stdin. Each line: `{"type":"...","data":{...}}`. Or argv form: `$EMIT -- TYPE1 '{...}' TYPE2 '{...}'`.

## Steps

### 1. Read config + load samples (ONE Bash call)

```bash
RUN_DIR=...; ROOT=...; PY=...; EMIT="$PY ..."
cat $RUN_DIR/config.json
$PY $ROOT/scripts/load_samples.py --count <samples_per_file> --difficulty <diff> "<sample_files...>"
$EMIT -- workflow_start '{"count":N,"topic":"...","difficulty":"...","mcq_type":"..."}'
```

Run this as ONE bash command. Parse config + samples from the output.

### 2. Generate MCQs

Write `$RUN_DIR/draft.json` with the array of `count` MCQs matching this shape:

```json
{
  "id": "<short-slug>",
  "type": "general" | "code",
  "topic": "<config.topic>",
  "difficulty": "<config.difficulty>",
  "question": "...",
  "options": ["A","B","C","D"],
  "correct_index": <0..3>,
  "explanation": "1-2 sentences",
  "snippet": { "language": "<lang>", "code": "..." }   // only for type=code
}
```

Hard constraints:
- Exactly 4 options.
- Questions must be NOVEL — paraphrase, change identifiers, change numeric values. Do not reproduce textbook questions.
- For type=code: snippet must compile and produce a single deterministic stdout that equals options[correct_index] after `.strip()`.

After writing draft.json, emit `phase` (generate done) and `generated` in ONE batched call. Then emit ALL `question_start` events in ANOTHER single batched call:

```bash
$EMIT <<EOF
{"type":"phase","data":{"phase":"generate","message":"Generated"}}
{"type":"generated","data":{"count":N}}
{"type":"question_start","data":{"index":0,"id":"...","question":{...}}}
{"type":"question_start","data":{"index":1,...}}
...
EOF
```

### 3. Plag-check (parallel)

In a SINGLE message, dispatch one `mcq-plag-checker` Task per question. Plus emit all `plag_check` events in ONE bash heredoc BEFORE the dispatch (or interleaved — order isn't strict, but minimize bash calls).

Each Task prompt is the MCQ JSON object (question + options + snippet if present) **with `"quality": "<config.quality>"` added**. The quality field caps the plag-checker's WebSearch budget: `fast`=1, `balanced`=2, `highest`=3. Passing it is what makes fast mode actually fast — don't omit it.

When all Tasks return, collect verdicts. Emit ALL plag_unique/plag_flagged events in ONE batched bash call.

### 4. Revamp loop (only if any flagged)

For each flagged MCQ, rewrite it inline (no subagent — you do it). Preserve concept and difficulty, change surface form. For code MCQs, also rewrite the snippet so its stdout still equals one of the new options.

Then re-dispatch plag-checkers (in parallel again) for the rewritten MCQs only. Repeat up to `max_revamp_attempts`.

Emit `revamping`, `plag_check`, `plag_unique`/`plag_flagged`/`plag_gave_up` events batched per round.

### 5. Code verify (only if type=code) — INLINE, NO SUBAGENT

Do NOT dispatch `mcq-code-verifier` Tasks. Each subagent spawn costs ~5-10s of latency, and verification is just "run the snippet, compare stdout". Do it yourself in ONE bash call.

**5a. Write all snippets + run them in parallel in one heredoc.** For each code MCQ at index `i` with language `L` and code `C`:

```bash
mkdir -p $RUN_DIR/verify
# Write each snippet
cat > $RUN_DIR/verify/0.<ext> <<'SNIPPET_EOF'
<code for MCQ 0>
SNIPPET_EOF
cat > $RUN_DIR/verify/2.<ext> <<'SNIPPET_EOF'
<code for MCQ 2>
SNIPPET_EOF
# ... (only indices whose type=code)

# Run all snippets in parallel, write each JSON result to its own file.
(
  $PY $ROOT/scripts/run_code.py <L0> $RUN_DIR/verify/0.<ext> > $RUN_DIR/verify/0.json 2>&1 &
  $PY $ROOT/scripts/run_code.py <L2> $RUN_DIR/verify/2.<ext> > $RUN_DIR/verify/2.json 2>&1 &
  wait
)
# Print all results to stdout so you can read them in this turn.
for f in $RUN_DIR/verify/*.json; do echo "=== $f ==="; cat "$f"; done
```

File extensions: `python→py, javascript→js, java→java, c→c, cpp→cpp, html→html, csharp→cs, css→css`. For Java, name the file after the public class (e.g. `Main.java`); `run_code.py` re-extracts it from the source anyway, so the filename only needs the right extension.

**5b. Apply each verdict inline.** For each code MCQ, parse its `<i>.json`, compute `actual = stdout.strip()` and `declared = options[correct_index].strip()`, then:

- `actual == declared` → `code_verified=true`, `fix="none"`
- `actual` matches a different option (by `.strip()`) → set `correct_index` to that index, `code_verified=true`, `fix="reassigned_correct_index"`
- `actual` matches no option AND `ok=true` → rewrite `options` as `[actual, <3 plausible distractors>]`, shuffle, fix `correct_index`, `code_verified=true`, `fix="regenerate_options"`
- `ok=false` and `stderr` contains `"no host toolchain"` → `code_verified=null`, `fix="skipped_unsupported_language"`
- `exit_code=124` → `code_verified=false`, `fix="timeout"`
- Otherwise (`ok=false`) → `code_verified=false`, `fix="compile_or_runtime_error"`

Set `code_actual_output=actual` on every code MCQ. Emit `code_verify` + `code_verified` events batched in ONE `$EMIT` heredoc.

### 6. Finalize (ONE Bash call)

Write `$RUN_DIR/final.json` with the array. Then batch-emit ALL `question_done` + `workflow_done` in one heredoc:

```bash
$EMIT <<EOF
{"type":"question_done","data":{"index":0,"question":{...}}}
{"type":"question_done","data":{"index":1,...}}
...
{"type":"workflow_done","data":{"count":N,"questions":[...]}}
EOF
```

## Failure handling

If anything fails: emit one `error` event with `{"phase":"...","message":"..."}` and stop. Don't retry beyond the revamp budget.
