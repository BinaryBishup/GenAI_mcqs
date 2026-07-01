import type { MCQ } from "./types";
import { buildMettlWorkbook } from "./mettl-export";
import { isUsable } from "./utils";

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
    m.code_verified ?? "",
    m.code_actual_output ?? "",
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
  // mettl: .xlsx bulk-upload file matching the official template (see
  // buildMettlWorkbook for why .xlsx and not .xls).
  const bytes = buildMettlWorkbook(mcqs, { topicOverride: topic });
  trigger(
    new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    `mettl-bulk-${slugify(topic) || "export"}-${timestamp()}.xlsx`,
  );
}

// ---- PDF export -----------------------------------------------------------

/**
 * Render an inline SVG string to a PNG data URL (+ intrinsic size) via a
 * canvas, so jsPDF can embed it. Resolves null on any failure (best-effort —
 * a missing diagram never blocks the PDF).
 */
function svgToPng(svg: string): Promise<{ dataUrl: string; w: number; h: number } | null> {
  return new Promise((resolve) => {
    try {
      // Pull width/height from the viewBox so the raster is crisp.
      const vb = svg.match(/viewBox="([\d.\s-]+)"/);
      let w = 620, h = 360;
      if (vb) {
        const p = vb[1].trim().split(/\s+/).map(Number);
        if (p.length === 4 && p[2] > 0 && p[3] > 0) { w = p[2]; h = p[3]; }
      }
      const scale = 2; // supersample for print sharpness
      const img = new Image();
      const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      img.onload = () => {
        try {
          const canvas = document.createElement("canvas");
          canvas.width = w * scale;
          canvas.height = h * scale;
          const ctx = canvas.getContext("2d")!;
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          const dataUrl = canvas.toDataURL("image/png");
          URL.revokeObjectURL(url);
          resolve({ dataUrl, w, h });
        } catch { URL.revokeObjectURL(url); resolve(null); }
      };
      img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
      img.src = url;
    } catch { resolve(null); }
  });
}

/**
 * Build and download a PDF of the questions. `withAnswers` includes the
 * correct-option highlight + explanation; without it, it's a clean question
 * paper. Inline SVG diagrams are rasterized and embedded.
 */
export async function downloadQuestionsPdf(
  mcqs: MCQ[],
  topic: string,
  withAnswers: boolean,
) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const MARGIN = 48;
  const PAGE_W = doc.internal.pageSize.getWidth();
  const PAGE_H = doc.internal.pageSize.getHeight();
  const CONTENT_W = PAGE_W - MARGIN * 2;
  let y = MARGIN;

  const ensure = (need: number) => {
    if (y + need > PAGE_H - MARGIN) { doc.addPage(); y = MARGIN; }
  };
  const write = (text: string, opts: { size?: number; bold?: boolean; color?: [number, number, number]; indent?: number; gap?: number } = {}) => {
    const size = opts.size ?? 11;
    doc.setFontSize(size);
    doc.setFont("helvetica", opts.bold ? "bold" : "normal");
    doc.setTextColor(...(opts.color ?? [17, 24, 39]));
    const indent = opts.indent ?? 0;
    const lines = doc.splitTextToSize(text, CONTENT_W - indent) as string[];
    const lh = size * 1.35;
    for (const line of lines) {
      ensure(lh);
      doc.text(line, MARGIN + indent, y);
      y += lh;
    }
    if (opts.gap) y += opts.gap;
  };

  // Header
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.setTextColor(0, 15, 71);
  ensure(22);
  doc.text(topic || "Question set", MARGIN, y); y += 22;
  write(`${mcqs.length} question${mcqs.length === 1 ? "" : "s"}${withAnswers ? " · answer key" : ""}`, { size: 9.5, color: [120, 130, 140], gap: 10 });

  for (let i = 0; i < mcqs.length; i++) {
    const m = mcqs[i];
    ensure(30);
    y += 6;
    write(`Q${i + 1}. ${m.question}`, { size: 11.5, bold: true, gap: 4 });

    if (m.snippet?.code) {
      doc.setFont("courier", "normal");
      write(m.snippet.code, { size: 9, color: [40, 40, 40], indent: 8, gap: 2 });
    }

    if (m.image_svg) {
      const png = await svgToPng(m.image_svg);
      if (png) {
        const drawW = Math.min(CONTENT_W, 360);
        const drawH = (png.h / png.w) * drawW;
        ensure(drawH + 8);
        try { doc.addImage(png.dataUrl, "PNG", MARGIN, y, drawW, drawH); } catch { /* skip */ }
        y += drawH + 8;
      }
    }

    for (let j = 0; j < m.options.length; j++) {
      const letter = String.fromCharCode(65 + j);
      const correct = withAnswers && j === m.correct_index;
      write(`${letter}. ${m.options[j]}`, {
        size: 10.5,
        bold: correct,
        color: correct ? [26, 122, 44] : [40, 48, 58],
        indent: 12,
      });
    }

    if (withAnswers) {
      y += 2;
      write(`Answer: ${String.fromCharCode(65 + m.correct_index)}`, { size: 10, bold: true, color: [26, 122, 44], indent: 12 });
      if (m.explanation) write(`Why: ${m.explanation}`, { size: 9.5, color: [90, 98, 108], indent: 12, gap: 4 });
    }
    y += 8;
  }

  const base = withAnswers ? "answer-key" : "question-paper";
  doc.save(`${base}-${slugify(topic) || "export"}-${timestamp()}.pdf`);
}
