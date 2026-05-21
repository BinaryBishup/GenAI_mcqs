/**
 * Seed the `samples` table from the legacy .xls workbooks in ../samples/.
 *
 * Run with: `npm run seed:samples`
 *
 * The .xls schema:
 *   Topic | Difficulty Level | Question Text | Answer Choice 1..8 | Correct Answer
 *
 * Question / option text contains HTML; code MCQs embed code in a
 *   /corporate/question/codesnippet?mode=<LANG>&code=<urlencoded>
 * iframe. We strip HTML and decode that iframe.
 */
import "dotenv/config";
import { readdirSync } from "fs";
import { join, basename } from "path";
import * as XLSX from "xlsx";
import { createClient } from "@supabase/supabase-js";

const SAMPLES_DIR = join(process.cwd(), "samples");

type Difficulty = "easy" | "medium" | "hard";
type Language =
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

function correctIndex(value: any): number | null {
  if (value == null) return null;
  const s = String(value).trim();
  const m = s.match(/choice\s*(\d+)/i);
  if (m) return parseInt(m[1], 10) - 1;
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n - 1 : null;
}

function normalizeTopic(stem: string): string {
  return stem.replace(/-general$/i, "").replace(/\s*-\s*/g, " — ").trim();
}

interface SampleRow {
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

function parseWorkbook(path: string): SampleRow[] {
  const wb = XLSX.readFile(path);
  const out: SampleRow[] = [];
  const filename = basename(path);
  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1, defval: "" });
    if (rows.length < 2) continue;
    const header = rows[0].map((h: any) => String(h ?? "").toLowerCase().trim());
    if (!header.includes("question text")) continue;
    const colTopic = header.indexOf("topic") >= 0 ? header.indexOf("topic") : 0;
    const colDiff = header.indexOf("difficulty level") >= 0 ? header.indexOf("difficulty level") : 1;
    const colQ = header.indexOf("question text");
    const colCorrect = header.indexOf("correct answer") >= 0 ? header.indexOf("correct answer") : header.length - 1;
    const choiceCols: number[] = [];
    for (let c = colQ + 1; c < colCorrect; c++) choiceCols.push(c);

    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      const rawQ = String(row[colQ] ?? "");
      if (!rawQ.trim()) continue;
      const rawOpts = choiceCols.map((c) => String(row[c] ?? ""));
      const options = rawOpts.map(htmlToText).filter(Boolean).slice(0, 8);
      if (options.length < 2) continue;
      const ci = correctIndex(row[colCorrect]);
      if (ci == null || ci < 0 || ci >= options.length) continue;

      const snippet = extractSnippet(rawQ);
      const type = snippet ? "code" : "general";
      const diffStr = String(row[colDiff] ?? "").toUpperCase().trim();
      const difficulty = DIFFICULTY_MAP[diffStr] ?? "medium";
      const topic = String(row[colTopic] ?? "").trim() || normalizeTopic(filename.replace(/\.xls$/i, ""));

      out.push({
        source_file: filename,
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

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local");
  const supa = createClient(url, key, { auth: { persistSession: false } });

  const files = readdirSync(SAMPLES_DIR).filter((f) => f.toLowerCase().endsWith(".xls"));
  console.log(`Found ${files.length} sample workbooks in ${SAMPLES_DIR}`);

  let total = 0;
  for (const f of files) {
    const rows = parseWorkbook(join(SAMPLES_DIR, f));
    if (rows.length === 0) {
      console.log(`  ${f}: 0 rows (skipped)`);
      continue;
    }
    // Delete prior rows for this file first so reruns are idempotent.
    await supa.from("samples").delete().eq("source_file", f);
    const chunks: SampleRow[][] = [];
    for (let i = 0; i < rows.length; i += 200) chunks.push(rows.slice(i, i + 200));
    for (const chunk of chunks) {
      const { error } = await supa.from("samples").insert(chunk);
      if (error) throw new Error(`insert ${f}: ${error.message}`);
    }
    console.log(`  ${f}: ${rows.length} rows`);
    total += rows.length;
  }
  console.log(`\nDone. ${total} samples inserted.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
