#!/usr/bin/env python3
"""Aggregate all per-file JSONs in generated/ into a single CSV.

Output columns mirror the .xls schema:
    Topic, Difficulty Level, Question Text,
    Answer Choice 1..N, Correct Answer (e.g. Choice3)
"""
from __future__ import annotations

import csv
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
GEN_DIR = ROOT / "generated"
OUT_CSV = ROOT / "generated_mcqs.csv"

DIFF_MAP = {
    "easy": "EASY", "EASY": "EASY",
    "medium": "MEDIUM", "MEDIUM": "MEDIUM",
    "hard": "DIFFICULT", "DIFFICULT": "DIFFICULT",
}


def difficulty_norm(d: str) -> str:
    if not d:
        return "MEDIUM"
    return DIFF_MAP.get(d, DIFF_MAP.get(d.upper(), "MEDIUM"))


def question_text(rec: dict) -> str:
    q = (rec.get("question") or "").strip()
    code = rec.get("code") or ""
    lang = rec.get("language") or ""
    if code:
        sep = "\n\n--- Code ---\n"
        if lang:
            sep = f"\n\n--- Code ({lang}) ---\n"
        q = f"{q}{sep}{code}".strip()
    return q


def main() -> int:
    files = sorted(GEN_DIR.glob("*.json"))
    if not files:
        print("no generated json files", file=sys.stderr)
        return 1

    rows: list[dict] = []
    max_opts = 0
    for fp in files:
        try:
            data = json.loads(fp.read_text())
        except Exception as e:
            print(f"skip {fp.name}: {e}", file=sys.stderr)
            continue
        if not isinstance(data, list):
            print(f"skip {fp.name}: not a list", file=sys.stderr)
            continue
        for rec in data:
            opts = rec.get("options") or []
            if len(opts) < 2:
                continue
            ci = rec.get("correct_index")
            if not isinstance(ci, int) or not (0 <= ci < len(opts)):
                continue
            max_opts = max(max_opts, len(opts))
            rows.append({
                "topic": rec.get("topic", fp.stem),
                "difficulty": difficulty_norm(rec.get("difficulty", "medium")),
                "question": question_text(rec),
                "options": opts,
                "correct_index": ci,
            })

    if not rows:
        print("no rows to write", file=sys.stderr)
        return 1

    header = ["Topic", "Difficulty Level", "Question Text"]
    header += [f"Answer Choice {i + 1}" for i in range(max_opts)]
    header.append("Correct Answer")

    with OUT_CSV.open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f, quoting=csv.QUOTE_ALL)
        w.writerow(header)
        for r in rows:
            choices: list[str] = list(r["options"])
            while len(choices) < max_opts:
                choices.append("")
            w.writerow([
                r["topic"],
                r["difficulty"],
                r["question"],
                *choices,
                f"Choice{r['correct_index'] + 1}",
            ])

    print(f"wrote {len(rows)} rows to {OUT_CSV}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
