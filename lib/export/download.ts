import type { MCQ } from "@/lib/types";
import { buildMettlWorkbook } from "@/lib/export/mettl-export";
import { isUsable } from "@/lib/utils";

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 60);
}

function timestamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

function csvField(v: unknown): string {
  const s = String(v ?? "");
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function toCsv(mcqs: MCQ[]): string {
  const headers = [
    "id", "type", "topic", "difficulty",
    "question", "snippet_language", "snippet_code",
    "option_a", "option_b", "option_c", "option_d",
    "correct_index", "correct_answer", "explanation",
    "plag_status", "plag_attempts",
    "answer_check_status", "answer_check_notes",
  ];
  const rows = mcqs.map((m) => [
    m.id, m.type, m.topic, m.difficulty,
    m.question,
    m.snippet?.language ?? "",
    m.snippet?.code ?? "",
    m.options[0] ?? "", m.options[1] ?? "", m.options[2] ?? "", m.options[3] ?? "",
    m.correct_index, m.options[m.correct_index] ?? "",
    m.explanation ?? "",
    m.plag_status ?? "",
    m.plag_attempts ?? 0,
    m.answer_check_status ?? "",
    m.answer_check_notes ?? "",
  ]);
  return [headers, ...rows].map((r) => r.map(csvField).join(",")).join("\n");
}

function trigger(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 500);
}

export type DownloadFormat = "json" | "csv" | "mettl";

/** Count of MCQs that would be excluded from a default export. */
export function flaggedCount(mcqs: MCQ[]): number {
  return mcqs.filter((m) => !isUsable(m)).length;
}

/**
 * Export MCQs. By default, items that failed a quality gate (plagiarism,
 * code-verify, or the independent answer-check) are EXCLUDED — only ship
 * questions we're confident in. Pass { includeFlagged: true } to export the
 * full set regardless.
 */
export function downloadMCQs(
  mcqs: MCQ[],
  format: DownloadFormat,
  topic: string,
  opts?: { includeFlagged?: boolean },
) {
  const list = opts?.includeFlagged ? mcqs : mcqs.filter(isUsable);
  if (list.length === 0) {
    // Nothing passed the gates — fall back to the full set so the user still
    // gets a file (the flags are visible in the UI and the CSV columns).
    return downloadMCQs(mcqs, format, topic, { includeFlagged: true });
  }
  return doDownload(list, format, topic);
}

function doDownload(mcqs: MCQ[], format: DownloadFormat, topic: string) {
  const base = `mcqs-${slugify(topic) || "export"}-${timestamp()}`;
  if (format === "json") {
    trigger(new Blob([JSON.stringify(mcqs, null, 2)], { type: "application/json" }), `${base}.json`);
    return;
  }
  if (format === "csv") {
    trigger(new Blob([toCsv(mcqs)], { type: "text/csv;charset=utf-8" }), `${base}.csv`);
    return;
  }
  // mettl: .xlsx bulk-upload file matching the official template (xlsx rather
  // than legacy .xls — the BIFF writer truncated long question text).
  const bytes = buildMettlWorkbook(mcqs, { topicOverride: topic });
  trigger(
    new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    `mettl-bulk-${slugify(topic) || "export"}-${timestamp()}.xlsx`,
  );
}
