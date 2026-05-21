import * as XLSX from "xlsx";
import type { Language, MCQ } from "./types";

/**
 * Build an .xls file in Mettl's bulk-upload format from a set of MCQs.
 *
 * Spec (MCQ sheet, 14 cols):
 *   Topic | Difficulty Level | Question Text | Answer Choice 1..6 |
 *   Correct answer | Answer Description (optional) | Question ID (optional) |
 *   Action (optional) | Tags
 *
 * Gotchas:
 *   - Difficulty values are "Easy" / "Medium" / "Difficult" (NOT "Hard").
 *   - Correct answer is "Choice 1".."Choice 6" — a space between "Choice" and
 *     the number, otherwise Mettl rejects the row.
 *   - Code MCQs embed code via Mettl's own iframe pattern so the rendered
 *     question shows a syntax-highlighted code block:
 *         <iframe src="/corporate/question/codesnippet?mode=PYTHON&code=URL_ENCODED"
 *                 frameborder="0" width="100%" height="200"></iframe>
 *   - Mettl ignores all sheets except the populated ones, so a single-sheet
 *     workbook works.
 */

const MCQ_HEADERS = [
  "Topic",
  "Difficulty Level",
  "Question Text",
  "Answer Choice 1",
  "Answer Choice 2",
  "Answer Choice 3 (optional)",
  "Answer Choice 4 (optional)",
  "Answer Choice 5 (optional)",
  "Answer Choice 6 (optional)",
  "Correct answer",
  "Answer Description (optional)",
  "Question ID (optional)",
  "Action (optional)",
  "Tags",
];

const DIFFICULTY_MAP = {
  easy: "Easy",
  medium: "Medium",
  hard: "Difficult",
} as const;

const LANG_MODE: Record<Language, string> = {
  python: "PYTHON",
  java: "JAVA",
  c: "C",
  cpp: "CPP",
  csharp: "CSHARP",
  javascript: "JAVASCRIPT",
  html: "HTML",
  css: "CSS",
};

function buildCodeSnippetIframe(language: Language, code: string): string {
  const mode = LANG_MODE[language] ?? "PYTHON";
  const encoded = encodeURIComponent(code);
  return `<iframe src="/corporate/question/codesnippet?mode=${mode}&code=${encoded}" frameborder="0" width="100%" height="200"></iframe>`;
}

function buildQuestionText(mcq: MCQ): string {
  // Wrap question in a <div> for Mettl's rich-text editor. Append the
  // codesnippet iframe for code MCQs (matches the format Mettl exports).
  const stem = `<div>${escapeHtml(mcq.question)}</div>`;
  if (mcq.snippet?.code && mcq.type === "code") {
    return stem + buildCodeSnippetIframe(mcq.snippet.language, mcq.snippet.code);
  }
  return stem;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function correctAnswerLabel(index: number): string {
  return `Choice ${index + 1}`;
}

function buildTags(mcq: MCQ, batchTopic: string): string {
  const tags = [batchTopic, mcq.type];
  if (mcq.snippet?.language) tags.push(mcq.snippet.language);
  return tags.filter(Boolean).join(", ");
}

export interface MettlExportOptions {
  /** The top-level topic name written to every row (defaults to mcq.topic). */
  topicOverride?: string;
}

/**
 * Build the workbook as a binary ArrayBuffer. Caller turns it into a Blob and
 * triggers the download.
 */
export function buildMettlWorkbook(mcqs: MCQ[], opts: MettlExportOptions = {}): ArrayBuffer {
  const rows: (string | number)[][] = [MCQ_HEADERS];

  for (const mcq of mcqs) {
    const topic = opts.topicOverride ?? mcq.topic ?? "Generated";
    const difficulty = DIFFICULTY_MAP[mcq.difficulty] ?? "Medium";
    const opts1to6 = [0, 1, 2, 3, 4, 5].map((i) => mcq.options[i] ?? "");
    const correct = correctAnswerLabel(mcq.correct_index);
    const explanation = mcq.explanation ?? "";
    const id = mcq.id ?? "";
    const tags = buildTags(mcq, topic);

    rows.push([
      topic,
      difficulty,
      buildQuestionText(mcq),
      ...opts1to6,
      correct,
      explanation,
      id,
      "", // Action
      tags,
    ]);
  }

  const sheet = XLSX.utils.aoa_to_sheet(rows);

  // Reasonable column widths so the file looks sane when opened in Excel.
  sheet["!cols"] = [
    { wch: 28 }, // Topic
    { wch: 14 }, // Difficulty
    { wch: 60 }, // Question
    { wch: 24 }, { wch: 24 }, { wch: 24 }, { wch: 24 }, { wch: 24 }, { wch: 24 },
    { wch: 14 }, // Correct
    { wch: 40 }, // Description
    { wch: 22 }, // ID
    { wch: 10 }, // Action
    { wch: 32 }, // Tags
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, "MCQ");

  // Mettl reads .xls (BIFF8) by default. We emit .xls to match the template
  // extension. type:"array" returns an ArrayBuffer which a Blob accepts directly.
  return XLSX.write(wb, { type: "array", bookType: "xls" }) as ArrayBuffer;
}
