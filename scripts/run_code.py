#!/usr/bin/env python3
"""Compile + run a code snippet and print {ok,stdout,stderr,exit_code,duration_ms} as JSON.

Usage:
    run_code.py <language> <source_file> [--stdin <stdin_file>]

Language is one of: python, java, cpp, c, javascript, html.
csharp and css report skipped_unsupported_language.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))

from app.compiler.runner import run_code  # noqa: E402


async def amain() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("language")
    ap.add_argument("source")
    ap.add_argument("--stdin", default=None)
    args = ap.parse_args()

    code = Path(args.source).read_text()
    stdin = Path(args.stdin).read_text() if args.stdin else None
    result = await run_code(args.language, code, stdin)
    json.dump(result.model_dump(), sys.stdout, indent=2)
    print()
    return 0 if result.ok else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(amain()))
