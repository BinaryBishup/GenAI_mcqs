from __future__ import annotations

import asyncio
import json
import os
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sse_starlette.sse import EventSourceResponse

from . import runner, samples_loader
from .compiler.runner import check_toolchains
from .event_bus import bus
from .schemas import GenerateRequest

load_dotenv()

app = FastAPI(title="MCQ Workflow (CLI-native)")

FRONTEND_ORIGIN = os.getenv("FRONTEND_ORIGIN", "http://localhost:3000")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[FRONTEND_ORIGIN, "http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

_jobs: dict[str, asyncio.Task] = {}


@app.get("/api/health")
async def health() -> dict:
    return {
        "ok": True,
        "model": os.getenv("ANTHROPIC_MODEL", "haiku"),
        "has_api_key": bool(os.getenv("ANTHROPIC_API_KEY", "").strip()) and
                       os.getenv("ANTHROPIC_API_KEY", "").strip() not in ("sk-ant-...", "..."),
        "toolchains": check_toolchains(),
        "runner": "claude-cli",
    }


@app.get("/api/samples/catalog")
async def samples_catalog() -> dict:
    items = samples_loader.catalog()
    return {
        "samples_dir": str(samples_loader.SAMPLES_DIR),
        "count": len(items),
        "items": items,
    }


@app.get("/api/samples/{filename}")
async def samples_file(filename: str) -> dict:
    try:
        mcqs = samples_loader.load_file(filename)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"not found: {filename}")
    return {
        "filename": filename,
        "count": len(mcqs),
        "items": [m.model_dump(exclude_none=True) for m in mcqs],
    }


@app.post("/api/generate")
async def generate(req: GenerateRequest) -> dict:
    sid = bus.new_session()
    task = asyncio.create_task(runner.run(sid, req))
    _jobs[sid] = task
    task.add_done_callback(lambda _t, s=sid: _jobs.pop(s, None))
    return {"session_id": sid}


@app.get("/api/events/{sid}")
async def events(sid: str):
    if not bus.has(sid):
        raise HTTPException(status_code=404, detail="unknown session")

    async def event_gen():
        try:
            async for evt in bus.stream(sid):
                yield {"event": evt.type, "data": json.dumps(evt.data)}
        finally:
            bus.drop(sid)

    return EventSourceResponse(event_gen())


@app.get("/api/runs/{run_id}/final")
async def run_final(run_id: str) -> dict:
    """Return final.json for a completed run."""
    fp = runner.RUNS_DIR / run_id / "final.json"
    if not fp.is_file():
        raise HTTPException(status_code=404, detail="no final.json yet")
    return {"run_id": run_id, "questions": json.loads(fp.read_text())}
