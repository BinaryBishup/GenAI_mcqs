"""Parse the .xls sample files in ../samples/ into MCQ objects.

Schema observed in the .xls files:

    Topic | Difficulty Level | Question Text | Answer Choice 1 .. 8 | Correct Answer

- Question / option text contains rich HTML (<div>, <br />, <code>, <strong>, lists, etc.).
- Code MCQs embed code as an iframe whose src is
  /corporate/question/codesnippet?mode=<LANG>&code=<urlencoded source>
- Correct Answer is a string like "Choice1"..."Choice8".
- Difficulty Level is EASY / MEDIUM / DIFFICULT (we map to easy/medium/hard).
"""
from __future__ import annotations

import re
import urllib.parse
import uuid
from functools import lru_cache
from html.parser import HTMLParser
from pathlib import Path
from typing import Any, Optional

import xlrd

from .schemas import MCQ, CodeSnippet, Difficulty, Language

# samples/ lives next to backend/, so go up one level.
SAMPLES_DIR = (Path(__file__).resolve().parent.parent.parent / "samples").resolve()


DIFFICULTY_MAP: dict[str, Difficulty] = {
    "EASY": "easy",
    "MEDIUM": "medium",
    "DIFFICULT": "hard",
    "HARD": "hard",
}

# iframe mode= values to our Language enum.
LANG_MAP: dict[str, Language] = {
    "PYTHON": "python",
    "PYTHON3": "python",
    "JAVA": "java",
    "C": "c",
    "CPP": "cpp",
    "C++": "cpp",
    "CSHARP": "csharp",
    "C#": "csharp",
    "JAVASCRIPT": "javascript",
    "JS": "javascript",
    "HTML": "html",
    "HTML5": "html",
    "CSS": "css",
    "CSS3": "css",
}


# --- HTML stripping ---------------------------------------------------------

class _TextExtractor(HTMLParser):
    """Render HTML to plain text. <br>, </p>, </div>, </li> become newlines."""

    BLOCK = {"p", "div", "li", "tr", "br", "h1", "h2", "h3", "h4", "h5", "h6", "pre"}

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.buf: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag == "br":
            self.buf.append("\n")
        elif tag == "li":
            self.buf.append("\n• ")

    def handle_endtag(self, tag: str) -> None:
        if tag in self.BLOCK:
            self.buf.append("\n")

    def handle_data(self, data: str) -> None:
        self.buf.append(data)


def html_to_text(s: str) -> str:
    if not s:
        return ""
    p = _TextExtractor()
    p.feed(s)
    text = "".join(p.buf)
    # Collapse runs of blank lines but keep paragraph breaks.
    text = re.sub(r"[ \t]+\n", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


# --- Code snippet extraction ------------------------------------------------

_IFRAME_RX = re.compile(
    r'<iframe[^>]*src="([^"]*codesnippet[^"]*)"',
    re.I,
)


def extract_snippet(html: str) -> Optional[CodeSnippet]:
    """If the HTML embeds a code snippet via the codesnippet iframe, decode it."""
    m = _IFRAME_RX.search(html)
    if not m:
        return None
    src = m.group(1)
    # Some sources escape & as &amp;
    src = src.replace("&amp;", "&")
    qs = urllib.parse.urlparse(src).query
    params = urllib.parse.parse_qs(qs)
    mode = (params.get("mode", [""])[0] or "").strip().upper()
    code = params.get("code", [""])[0]
    if not code:
        return None
    lang = LANG_MAP.get(mode)
    if not lang:
        # Default to python if mode missing/unknown but a snippet exists.
        lang = "python"
    return CodeSnippet(language=lang, code=code)


# --- Workbook parsing -------------------------------------------------------

def _correct_index(value: Any) -> Optional[int]:
    if value is None:
        return None
    s = str(value).strip()
    # "Choice3" -> 2
    m = re.match(r"choice\s*(\d+)", s, re.I)
    if m:
        return int(m.group(1)) - 1
    # Sometimes a bare integer
    try:
        return int(s) - 1
    except ValueError:
        return None


def _normalize_topic_from_filename(name: str) -> str:
    base = re.sub(r"-general$", "", name, flags=re.I)
    base = re.sub(r"\s*-\s*", " — ", base.strip())
    return base


def parse_workbook(path: Path) -> list[MCQ]:
    """Parse one .xls into a list of MCQs. Skips malformed rows."""
    book = xlrd.open_workbook(str(path))
    out: list[MCQ] = []
    for sheet in book.sheets():
        if sheet.nrows < 2 or sheet.ncols < 5:
            continue
        # Detect header row offset by checking the first cell.
        header = [str(sheet.cell_value(0, c)).strip().lower() for c in range(sheet.ncols)]
        if "question text" not in header:
            # Not the expected layout — skip.
            continue
        col_topic = header.index("topic") if "topic" in header else 0
        col_diff = header.index("difficulty level") if "difficulty level" in header else 1
        col_q = header.index("question text")
        col_correct = header.index("correct answer") if "correct answer" in header else sheet.ncols - 1
        # Answer choices are between col_q+1 and col_correct (exclusive).
        choice_cols = list(range(col_q + 1, col_correct))

        for r in range(1, sheet.nrows):
            try:
                raw_topic = str(sheet.cell_value(r, col_topic)).strip()
                raw_diff = str(sheet.cell_value(r, col_diff)).strip().upper()
                raw_q = str(sheet.cell_value(r, col_q))
                raw_options = [str(sheet.cell_value(r, c)) for c in choice_cols]
                raw_correct = sheet.cell_value(r, col_correct)
            except IndexError:
                continue

            if not raw_q.strip():
                continue

            options_text = [html_to_text(o) for o in raw_options]
            options_text = [o for o in options_text if o]
            if len(options_text) < 2:
                continue
            if len(options_text) > 8:
                options_text = options_text[:8]

            ci = _correct_index(raw_correct)
            if ci is None or not (0 <= ci < len(options_text)):
                # If correct answer cell points to a now-empty option, skip.
                continue

            snippet = extract_snippet(raw_q)
            mcq_type = "code" if snippet else "general"
            question_text = html_to_text(raw_q)

            difficulty: Difficulty = DIFFICULTY_MAP.get(raw_diff, "medium")

            mcq = MCQ(
                id=f"{path.stem}-{r}-{uuid.uuid4().hex[:4]}",
                type=mcq_type,
                topic=raw_topic or _normalize_topic_from_filename(path.stem),
                difficulty=difficulty,
                question=question_text,
                options=options_text,
                correct_index=ci,
                snippet=snippet,
                plag_status="unique",  # samples are ground-truth, not generated
            )
            out.append(mcq)
    return out


# --- Catalog ----------------------------------------------------------------

@lru_cache(maxsize=128)
def _parse_cached(path_str: str, mtime: float) -> tuple[MCQ, ...]:
    return tuple(parse_workbook(Path(path_str)))


def load_file(filename: str) -> list[MCQ]:
    """Load one sample file by filename (relative to samples/)."""
    p = (SAMPLES_DIR / filename).resolve()
    if not p.is_file() or not str(p).startswith(str(SAMPLES_DIR)):
        raise FileNotFoundError(filename)
    return list(_parse_cached(str(p), p.stat().st_mtime))


def catalog() -> list[dict]:
    """List every sample file with quick metadata."""
    out: list[dict] = []
    if not SAMPLES_DIR.is_dir():
        return out
    for p in sorted(SAMPLES_DIR.glob("*.xls")):
        try:
            mcqs = _parse_cached(str(p), p.stat().st_mtime)
        except Exception as e:
            out.append({
                "filename": p.name,
                "topic": _normalize_topic_from_filename(p.stem),
                "count": 0,
                "error": str(e),
                "languages": [],
                "difficulties": [],
                "has_code": False,
            })
            continue
        langs = sorted({m.snippet.language for m in mcqs if m.snippet})
        diffs = sorted({m.difficulty for m in mcqs})
        out.append({
            "filename": p.name,
            "topic": mcqs[0].topic if mcqs else _normalize_topic_from_filename(p.stem),
            "count": len(mcqs),
            "languages": langs,
            "difficulties": diffs,
            "has_code": any(m.type == "code" for m in mcqs),
        })
    return out
