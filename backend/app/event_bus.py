"""Per-session async event queue. Workflow pushes, SSE endpoint pulls."""
from __future__ import annotations

import asyncio
import uuid
from typing import AsyncIterator

from .schemas import WorkflowEvent


class EventBus:
    def __init__(self) -> None:
        self._sessions: dict[str, asyncio.Queue[WorkflowEvent | None]] = {}

    def new_session(self) -> str:
        sid = uuid.uuid4().hex[:12]
        self._sessions[sid] = asyncio.Queue()
        return sid

    def has(self, sid: str) -> bool:
        return sid in self._sessions

    async def emit(self, sid: str, type_: str, **data) -> None:
        q = self._sessions.get(sid)
        if q is None:
            return
        await q.put(WorkflowEvent(type=type_, data=data))

    async def close(self, sid: str) -> None:
        q = self._sessions.get(sid)
        if q is not None:
            await q.put(None)

    def drop(self, sid: str) -> None:
        self._sessions.pop(sid, None)

    async def stream(self, sid: str) -> AsyncIterator[WorkflowEvent]:
        q = self._sessions.get(sid)
        if q is None:
            return
        while True:
            evt = await q.get()
            if evt is None:
                break
            yield evt


bus = EventBus()
