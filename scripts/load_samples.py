#!/usr/bin/env python3
"""Load sample MCQs from .xls files in samples/ and print JSON to stdout.

Usage:
    load_samples.py --count 4 "File A.xls" "File B.xls" ...
    load_samples.py --count 4 --difficulty medium "File A.xls"

The optional --difficulty flag prefers samples of that difficulty; falls back
to any difficulty if there aren't enough.
"""
from __future__ import annotations

import argparse
import json
import random
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))

from app.samples_loader import load_file  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--count", type=int, default=4)
    ap.add_argument("--difficulty", default=None,
                    choices=["easy", "medium", "hard", None])
    ap.add_argument("files", nargs="+")
    args = ap.parse_args()

    out: list[dict] = []
    for fname in args.files:
        try:
            mcqs = load_file(fname)
        except FileNotFoundError:
            print(f"warning: not found: {fname}", file=sys.stderr)
            continue
        if args.difficulty:
            same = [m for m in mcqs if m.difficulty == args.difficulty]
            pool = same if len(same) >= args.count else mcqs
        else:
            pool = mcqs
        random.shuffle(pool)
        for m in pool[: args.count]:
            out.append(m.model_dump(exclude_none=True))

    json.dump(out, sys.stdout, indent=2, ensure_ascii=False)
    print()
    return 0


if __name__ == "__main__":
    sys.exit(main())
