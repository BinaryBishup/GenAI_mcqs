#!/usr/bin/env python3
"""Append many progress events to <run-dir>/events.jsonl in one call.

Usage modes:

  # stdin (one JSON object per line, no trailing fields)
  cat events.jsonl | emit_events.py <run-dir>

  # repeated pairs of type + data on argv (each data is a JSON string)
  emit_events.py <run-dir> -- TYPE1 '{"k":"v"}' TYPE2 '{...}' ...

The orchestrator should prefer ONE call to this script per phase rather than
many calls to emit_event.py. Each Bash tool round-trip in Claude Code costs
a few seconds of agent latency; batching collapses N round-trips into 1.
"""
from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path


def _ts() -> str:
    return datetime.now(timezone.utc).isoformat()


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: emit_events.py <run-dir> [-- TYPE1 DATA1 TYPE2 DATA2 ...]", file=sys.stderr)
        return 2

    run_dir = Path(sys.argv[1])
    run_dir.mkdir(parents=True, exist_ok=True)
    events_path = run_dir / "events.jsonl"

    lines: list[str] = []

    # Argv form: emit_events.py <dir> -- type data type data ...
    if len(sys.argv) > 2 and sys.argv[2] == "--":
        pairs = sys.argv[3:]
        if len(pairs) % 2 != 0:
            print("argv mode requires an even number of TYPE DATA pairs", file=sys.stderr)
            return 2
        for i in range(0, len(pairs), 2):
            etype, raw = pairs[i], pairs[i + 1]
            try:
                data = json.loads(raw)
            except json.JSONDecodeError as e:
                print(f"invalid data JSON for {etype}: {e}", file=sys.stderr)
                return 2
            lines.append(json.dumps({"type": etype, "data": data, "ts": _ts()}, ensure_ascii=False))
    else:
        # stdin form: one JSON object {"type":..., "data":...} per line.
        for raw in sys.stdin:
            raw = raw.strip()
            if not raw:
                continue
            try:
                obj = json.loads(raw)
            except json.JSONDecodeError as e:
                print(f"skipping invalid line: {e}", file=sys.stderr)
                continue
            if "ts" not in obj:
                obj["ts"] = _ts()
            lines.append(json.dumps(obj, ensure_ascii=False))

    if lines:
        with events_path.open("a", encoding="utf-8") as f:
            f.write("\n".join(lines) + "\n")

    print(f"emitted {len(lines)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
