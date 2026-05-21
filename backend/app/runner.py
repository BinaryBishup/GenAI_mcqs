"""Spawn the Claude Code CLI to run /generate-mcqs and stream events.jsonl back to SSE.

This replaces the SDK-driven, subprocess-per-step workflow. We now run ONE
`claude -p` process per generation, which keeps the system context cache warm
and dramatically reduces wall-clock and token cost.

Layout per run:
    <project-root>/runs/<run-id>/
        config.json
        events.jsonl   (appended by the orchestrator)
        draft.json     (written by the orchestrator)
        final.json     (written by the orchestrator)
"""
from __future__ import annotations

import asyncio
import json
import os
import shutil
import time
import uuid
from pathlib import Path
from typing import AsyncIterator

from .event_bus import bus
from .schemas import GenerateRequest

# project-root/backend/app/runner.py -> project root is parents[3].
PROJECT_ROOT = Path(__file__).resolve().parents[2]
RUNS_DIR = PROJECT_ROOT / "runs"


def _resolve_claude_bin() -> str:
    explicit = os.getenv("CLAUDE_BIN")
    if explicit:
        return explicit
    found = shutil.which("claude")
    if not found:
        raise RuntimeError(
            "`claude` CLI not found on PATH. Install Claude Code or set CLAUDE_BIN."
        )
    return found


async def _tail_jsonl(path: Path, stop: asyncio.Event) -> AsyncIterator[dict]:
    """Yield each JSON-parsed line appended to `path`, until `stop` is set
    AND we've read to current EOF."""
    # Wait for file to exist (orchestrator may not have written its first event yet).
    while not path.exists():
        if stop.is_set():
            return
        await asyncio.sleep(0.1)

    pos = 0
    buf = ""
    while True:
        try:
            with path.open("rb") as f:
                f.seek(pos)
                chunk = f.read()
                pos = f.tell()
        except FileNotFoundError:
            await asyncio.sleep(0.1)
            continue

        if chunk:
            buf += chunk.decode("utf-8", errors="replace")
            while "\n" in buf:
                line, buf = buf.split("\n", 1)
                line = line.strip()
                if not line:
                    continue
                try:
                    yield json.loads(line)
                except json.JSONDecodeError:
                    continue
        else:
            if stop.is_set():
                # Final drain attempt
                if buf.strip():
                    try:
                        yield json.loads(buf.strip())
                    except json.JSONDecodeError:
                        pass
                return
            await asyncio.sleep(0.15)


def _run_dir(run_id: str) -> Path:
    return RUNS_DIR / run_id


def _write_config(run_id: str, req: GenerateRequest) -> Path:
    d = _run_dir(run_id)
    d.mkdir(parents=True, exist_ok=True)
    cfg = {
        "count": req.count,
        "topic": req.topic,
        "difficulty": req.difficulty,
        "mcq_type": req.mcq_type,
        "languages": req.languages,
        "sample_files": req.sample_files,
        "samples_per_file": req.samples_per_file,
        "max_revamp_attempts": req.max_revamp_attempts,
        "samples_raw": req.samples_raw,
        "quality": req.quality,
    }
    (d / "config.json").write_text(json.dumps(cfg, indent=2))
    return d


async def run(sid: str, req: GenerateRequest) -> None:
    """Spawn `claude -p '/generate-mcqs <run-dir>'`, tail events.jsonl, push to SSE."""
    run_id = uuid.uuid4().hex[:12]
    run_dir = _write_config(run_id, req)
    events_path = run_dir / "events.jsonl"
    final_path = run_dir / "final.json"

    claude_bin = _resolve_claude_bin()
    prompt = f"/generate-mcqs {run_dir}"

    # Inherit env but strip any placeholder API key so the CLI uses session auth.
    env = dict(os.environ)
    key = env.get("ANTHROPIC_API_KEY", "").strip()
    if not key or key in ("sk-ant-...", "...") or key.startswith("your-"):
        env.pop("ANTHROPIC_API_KEY", None)

    # Per-request quality picks the orchestrator model. Subagents pick their
    # own model via their .md frontmatter (haiku) and aren't affected.
    quality_to_model = {"fast": "haiku", "balanced": "sonnet", "highest": "opus"}
    orchestrator_model = (
        os.getenv("MCQ_ORCHESTRATOR_MODEL")
        or quality_to_model.get(req.quality, "haiku")
    )

    cmd = [
        claude_bin,
        "-p", prompt,
        "--model", orchestrator_model,
        "--dangerously-skip-permissions",
        "--output-format", "stream-json",
        "--verbose",
    ]

    await bus.emit(sid, "phase", phase="spawn",
                   message=f"Spawning claude -p /generate-mcqs ({run_id})")

    stop = asyncio.Event()
    proc = await asyncio.create_subprocess_exec(
        *cmd,
        cwd=str(PROJECT_ROOT),
        env=env,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )

    # Drain stdout/stderr into a debug log so the subprocess never blocks on a full pipe.
    log_path = run_dir / "claude.log"

    async def drain(pipe: asyncio.StreamReader, label: str) -> None:
        with log_path.open("ab") as f:
            f.write(f"\n--- {label} (pid {proc.pid}) ---\n".encode())
            while True:
                chunk = await pipe.read(4096)
                if not chunk:
                    break
                f.write(chunk)
                f.flush()

    drain_stdout = asyncio.create_task(drain(proc.stdout, "stdout"))  # type: ignore[arg-type]
    drain_stderr = asyncio.create_task(drain(proc.stderr, "stderr"))  # type: ignore[arg-type]

    workflow_done_seen = False
    start_ts = time.time()
    # Cache draft.json once it appears so we can enrich per-question events
    # (some orchestrators strip snippet.code from the event-stream payload).
    draft_path = run_dir / "draft.json"
    draft_index: dict[int, dict] = {}
    draft_by_id: dict[str, dict] = {}

    def _load_draft() -> None:
        nonlocal draft_index, draft_by_id
        if draft_index or not draft_path.exists():
            return
        try:
            items = json.loads(draft_path.read_text())
        except json.JSONDecodeError:
            return
        if isinstance(items, list):
            draft_index = {i: q for i, q in enumerate(items) if isinstance(q, dict)}
            draft_by_id = {q.get("id"): q for q in items if isinstance(q, dict) and q.get("id")}

    def _enrich_question(idx: int | None, q: dict | None) -> dict | None:
        """Merge any missing fields (notably snippet.code) from draft.json."""
        if not isinstance(q, dict):
            return q
        _load_draft()
        ref = None
        if isinstance(idx, int) and idx in draft_index:
            ref = draft_index[idx]
        elif q.get("id") and q["id"] in draft_by_id:
            ref = draft_by_id[q["id"]]
        if not ref:
            return q
        merged = {**ref, **{k: v for k, v in q.items() if v not in (None, "", [])}}
        # Deep-merge snippet so an empty code from the event doesn't blank the draft's code.
        snip_q = q.get("snippet") if isinstance(q.get("snippet"), dict) else None
        snip_ref = ref.get("snippet") if isinstance(ref.get("snippet"), dict) else None
        if snip_q or snip_ref:
            merged_snip = {**(snip_ref or {})}
            for sk, sv in (snip_q or {}).items():
                if sv in (None, "", []):
                    continue
                merged_snip[sk] = sv
            merged["snippet"] = merged_snip
        return merged

    async def waiter() -> None:
        await proc.wait()
        stop.set()

    waiter_task = asyncio.create_task(waiter())

    try:
        await bus.emit(sid, "phase", phase="tail",
                       message="Waiting for orchestrator events...",
                       run_id=run_id, run_dir=str(run_dir))
        async for evt in _tail_jsonl(events_path, stop):
            data = dict(evt.get("data") or {})
            etype = evt.get("type", "event")

            # Authoritative final state lives in final.json on disk — the
            # event-stream copy can be slim or malformed (e.g. snippets
            # stripped, `questions: <count>` instead of array). Always
            # overwrite from disk when we have it.
            if etype == "workflow_done":
                if final_path.exists():
                    try:
                        data["questions"] = json.loads(final_path.read_text())
                        data["count"] = len(data["questions"])
                    except json.JSONDecodeError:
                        pass
                workflow_done_seen = True

            # Enrich per-question events with missing fields (esp. snippet.code)
            # from draft.json so the streaming UI shows code blocks too.
            if etype in ("question_start", "question_done") and isinstance(data.get("question"), dict):
                data["question"] = _enrich_question(data.get("index"), data["question"])

            data["run_id"] = run_id
            await bus.emit(sid, etype, **data)

        # Subprocess has exited and JSONL is fully drained.
        rc = proc.returncode if proc.returncode is not None else -1
        elapsed = time.time() - start_ts

        if workflow_done_seen:
            await bus.emit(sid, "phase", phase="done",
                           message=f"Workflow finished in {elapsed:.1f}s (rc={rc}).")
        else:
            # Orchestrator never emitted workflow_done. Try to read final.json anyway.
            final = None
            if final_path.exists():
                try:
                    final = json.loads(final_path.read_text())
                except json.JSONDecodeError:
                    pass
            if final is not None:
                await bus.emit(sid, "workflow_done", count=len(final), questions=final,
                               note="recovered from final.json (no workflow_done emitted)")
            else:
                tail = ""
                if log_path.exists():
                    txt = log_path.read_text(errors="replace")
                    tail = txt[-2000:]
                await bus.emit(sid, "error", phase="claude",
                               message=f"claude exited rc={rc} without writing workflow_done",
                               run_id=run_id, log_tail=tail)
    finally:
        for t in (drain_stdout, drain_stderr, waiter_task):
            if not t.done():
                t.cancel()
        await bus.close(sid)
