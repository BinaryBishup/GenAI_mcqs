/**
 * Parse a legacy Mettl .xls workbook into sample MCQ rows.
 *
 * Shared by:
 *   - scripts/seed-samples.ts (CLI seeding from ../samples/*.xls)
 *   - app/api/samples/upload  (user uploads via the homepage)
 *
 * The .xls schema:
 *   Topic | Difficulty Level | Question Text | Answer Choice 1..8 | Correct Answer | ...
 *
 * Question / option text contains HTML; code MCQs embed code in a
 *   /corporate/question/codesnippet?mode=<LANG>&code=<urlencoded>
 * iframe. We strip HTML and decode that iframe.
 */
import * as XLSX from "xlsx";

export type Difficulty = "easy" | "medium" | "hard";
export type Language =
  | "python" | "java" | "cpp" | "c" | "csharp" | "javascript" | "html" | "css";

const DIFFICULTY_MAP: Record<string, Difficulty> = {
  EASY: "easy",
  MEDIUM: "medium",
  DIFFICULT: "hard",
  HARD: "hard",
};

const LANG_MAP: Record<string, Language> = {
  PYTHON: "python", PYTHON3: "python",
  JAVA: "java",
  C: "c", CPP: "cpp", "C++": "cpp",
  CSHARP: "csharp", "C#": "csharp",
  JAVASCRIPT: "javascript", JS: "javascript",
  HTML: "html", HTML5: "html",
  CSS: "css", CSS3: "css",
};

const BLOCK_TAGS = new Set(["p", "div", "li", "tr", "br", "h1", "h2", "h3", "h4", "h5", "h6", "pre"]);

function htmlToText(html: string): string {
  if (!html) return "";
  let out = "";
  let i = 0;
  while (i < html.length) {
    if (html[i] === "<") {
      const end = html.indexOf(">", i);
      if (end < 0) break;
      const tagRaw = html.slice(i + 1, end).trim();
      const close = tagRaw.startsWith("/");
      const name = (close ? tagRaw.slice(1) : tagRaw).split(/\s+/)[0]?.toLowerCase().replace(/\/$/, "");
      if (name === "br") out += "\n";
      else if (!close && name === "li") out += "\n• ";
      else if (close && name && BLOCK_TAGS.has(name)) out += "\n";
      i = end + 1;
    } else if (html[i] === "&") {
      const end = html.indexOf(";", i);
      if (end < 0) { out += html[i++]; continue; }
      const entity = html.slice(i, end + 1);
      out += decodeEntity(entity);
      i = end + 1;
    } else {
      out += html[i++];
    }
  }
  return out.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function decodeEntity(e: string): string {
  switch (e) {
    case "&amp;": return "&";
    case "&lt;": return "<";
    case "&gt;": return ">";
    case "&quot;": return '"';
    case "&#39;": case "&apos;": return "'";
    case "&nbsp;": return " ";
  }
  if (e.startsWith("&#x") || e.startsWith("&#X")) return String.fromCodePoint(parseInt(e.slice(3, -1), 16));
  if (e.startsWith("&#")) return String.fromCodePoint(parseInt(e.slice(2, -1), 10));
  return e;
}

const IFRAME_RX = /<iframe[^>]*src="([^"]*codesnippet[^"]*)"/i;
const IFRAME_RX_ALL = /<iframe[^>]*src="([^"]*codesnippet[^"]*)"[^>]*><\/iframe>/gi;

function extractSnippet(html: string): { language: Language; code: string } | null {
  const m = html.match(IFRAME_RX);
  if (!m) return null;
  const src = m[1].replace(/&amp;/g, "&");
  try {
    const u = new URL(src, "http://x.local");
    const mode = (u.searchParams.get("mode") ?? "").toUpperCase();
    const code = u.searchParams.get("code") ?? "";
    if (!code) return null;
    return { language: LANG_MAP[mode] ?? "python", code: decodeURIComponent(code) };
  } catch {
    return null;
  }
}

/**
 * Replace every `<iframe …codesnippet…>` in `html` with the decoded code,
 * wrapped in a fenced block so the LLM sees the actual code rather than an
 * empty placeholder after tag stripping. Used for option cells that contain
 * code snippets — e.g. "which snippet correctly defines X?" MCQs.
 */
function inlineIframeCode(html: string): string {
  return html.replace(IFRAME_RX_ALL, (_full, src) => {
    const cleaned = String(src).replace(/&amp;/g, "&");
    try {
      const u = new URL(cleaned, "http://x.local");
      const code = u.searchParams.get("code") ?? "";
      if (!code) return "";
      return "\n```\n" + decodeURIComponent(code) + "\n```\n";
    } catch {
      return "";
    }
  });
}

function correctIndex(value: unknown): number | null {
  if (value == null) return null;
  const s = String(value).trim();
  const m = s.match(/choice\s*(\d+)/i);
  if (m) return parseInt(m[1], 10) - 1;
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n - 1 : null;
}

export function normalizeTopic(stem: string): string {
  return stem.replace(/-general$/i, "").replace(/\s*-\s*/g, " — ").trim();
}

export interface SampleRow {
  source_file: string;
  topic: string;
  difficulty: Difficulty;
  type: "general" | "code";
  language: Language | null;
  question: string;
  options: string[];
  correct_index: number;
  code: string | null;
}

export interface ParseOptions {
  /** Force this source_file on every row (defaults to `filename`). */
  sourceFile?: string;
  /** Force this topic on every row (overrides the sheet's Topic column). */
  topicOverride?: string;
}

/**
 * Parse an already-loaded workbook into rows. `filename` is used as the
 * default source_file and as the fallback for an empty Topic column.
 */
export function parseWorkbook(
  wb: XLSX.WorkBook,
  filename: string,
  opts: ParseOptions = {},
): SampleRow[] {
  const out: SampleRow[] = [];
  const sourceFile = opts.sourceFile ?? filename;
  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "" });
    if (rows.length < 2) continue;
    const header = (rows[0] as unknown[]).map((h) => String(h ?? "").toLowerCase().trim());
    if (!header.includes("question text")) continue;
    const colTopic = header.indexOf("topic") >= 0 ? header.indexOf("topic") : 0;
    const colDiff = header.indexOf("difficulty level") >= 0 ? header.indexOf("difficulty level") : 1;
    const colQ = header.indexOf("question text");
    const colCorrect = header.indexOf("correct answer") >= 0 ? header.indexOf("correct answer") : header.length - 1;
    const choiceCols: number[] = [];
    for (let c = colQ + 1; c < colCorrect; c++) choiceCols.push(c);

    for (let r = 1; r < rows.length; r++) {
      const row = rows[r] as unknown[];
      const rawQ = String(row[colQ] ?? "");
      if (!rawQ.trim()) continue;
      const rawOpts = choiceCols.map((c) => String(row[c] ?? ""));
      // Some option cells embed Mettl codesnippet iframes (the option *is* a
      // code snippet). htmlToText strips the iframe, so inline the decoded
      // code first; otherwise those rows would be discarded.
      const options = rawOpts.map((o) => htmlToText(inlineIframeCode(o)))
        .filter(Boolean).slice(0, 8);
      if (options.length < 2) continue;
      const ci = correctIndex(row[colCorrect]);
      if (ci == null || ci < 0 || ci >= options.length) continue;

      const snippet = extractSnippet(rawQ);
      const type = snippet ? "code" : "general";
      const diffStr = String(row[colDiff] ?? "").toUpperCase().trim();
      const difficulty = DIFFICULTY_MAP[diffStr] ?? "medium";
      const topic = opts.topicOverride
        || String(row[colTopic] ?? "").trim()
        || normalizeTopic(filename.replace(/\.xlsx?$/i, ""));

      out.push({
        source_file: sourceFile,
        topic,
        difficulty,
        type,
        language: snippet?.language ?? null,
        question: htmlToText(rawQ),
        options,
        correct_index: ci,
        code: snippet?.code ?? null,
      });
    }
  }
  return out;
}

/** Parse from a raw file buffer (used by the upload API route). */
export function parseWorkbookBuffer(
  buf: Buffer | ArrayBuffer | Uint8Array,
  filename: string,
  opts: ParseOptions = {},
): SampleRow[] {
  const wb = XLSX.read(buf, { type: "buffer" });
  return parseWorkbook(wb, filename, opts);
}
