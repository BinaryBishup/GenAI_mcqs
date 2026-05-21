import type { MCQ } from "./types";
import { buildMettlWorkbook } from "./mettl-export";

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
    "plag_status", "plag_attempts", "code_verified", "code_actual_output",
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
    m.code_verified ?? "",
    m.code_actual_output ?? "",
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

export function downloadMCQs(mcqs: MCQ[], format: DownloadFormat, topic: string) {
  const base = `mcqs-${slugify(topic) || "export"}-${timestamp()}`;
  if (format === "json") {
    trigger(new Blob([JSON.stringify(mcqs, null, 2)], { type: "application/json" }), `${base}.json`);
    return;
  }
  if (format === "csv") {
    trigger(new Blob([toCsv(mcqs)], { type: "text/csv;charset=utf-8" }), `${base}.csv`);
    return;
  }
  // mettl: .xls bulk-upload file matching the official template.
  const bytes = buildMettlWorkbook(mcqs, { topicOverride: topic });
  trigger(
    new Blob([bytes], { type: "application/vnd.ms-excel" }),
    `mettl-bulk-${slugify(topic) || "export"}-${timestamp()}.xls`,
  );
}
