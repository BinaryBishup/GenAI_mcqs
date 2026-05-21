#!/usr/bin/env python3
"""Append one progress event to <run-dir>/events.jsonl.

Usage:
    emit_event.py <run-dir> <event_type> <data_json>

Data_json must be valid JSON (object). The output line is:
    {"type": "<event_type>", "data": <data>, "ts": <iso8601>}

Designed to be cheap to call from Bash inside the orchestrator markdown.
"""
from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path


def main() -> int:
    if len(sys.argv) < 4:
        print("usage: emit_event.py <run-dir> <event_type> <data_json>", file=sys.stderr)
        return 2
    run_dir = Path(sys.argv[1])
    event_type = sys.argv[2]
    try:
        data = json.loads(sys.argv[3])
    except json.JSONDecodeError as e:
        print(f"invalid data json: {e}", file=sys.stderr)
        return 2
    run_dir.mkdir(parents=True, exist_ok=True)
    line = json.dumps({
        "type": event_type,
        "data": data,
        "ts": datetime.now(timezone.utc).isoformat(),
    }, ensure_ascii=False)
    with (run_dir / "events.jsonl").open("a", encoding="utf-8") as f:
        f.write(line + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
