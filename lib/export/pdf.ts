import type { MCQ } from "@/lib/types";
import { isUsable } from "@/lib/utils";

/**
 * PDF export via the browser's print engine: build a clean printable document
 * in a new window and trigger the print dialog (Save as PDF). No PDF library
 * needed, and code blocks / SVG diagrams render exactly as on screen.
 */

const LETTERS = ["A", "B", "C", "D", "E", "F"];

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function questionBlock(m: MCQ, n: number, withAnswers: boolean): string {
  const opts = m.options
    .map((opt, i) => {
      const correct = withAnswers && i === m.correct_index;
      return `<div class="opt${correct ? " correct" : ""}"><span class="letter">${LETTERS[i]}</span><span>${esc(opt)}</span></div>`;
    })
    .join("");
  const snippet = m.snippet?.code ? `<pre>${esc(m.snippet.code)}</pre>` : "";
  const image = m.image_svg ? `<div class="diagram">${m.image_svg}</div>` : "";
  const answer = withAnswers
    ? `<div class="answer">Answer: ${LETTERS[m.correct_index] ?? "?"}${m.explanation ? ` — ${esc(m.explanation)}` : ""}</div>`
    : "";
  return `<section class="q">
    <div class="qhead">Q${n} <span class="diff">${esc(m.difficulty)}</span></div>
    <div class="stem">${esc(m.question)}</div>
    ${snippet}${image}
    <div class="opts">${opts}</div>
    ${answer}
  </section>`;
}

export function exportPdf(mcqs: MCQ[], topic: string, withAnswers: boolean): boolean {
  const list = mcqs.filter(isUsable);
  const items = (list.length ? list : mcqs).map((m, i) => questionBlock(m, i + 1, withAnswers)).join("");
  const title = `${topic} — ${withAnswers ? "with answers" : "question paper"}`;
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>
  * { box-sizing: border-box; margin: 0; }
  body { font: 13px/1.55 -apple-system, "Segoe UI", Roboto, Arial, sans-serif; color: #14213D; padding: 32px 36px; }
  header { border-bottom: 2px solid #14213D; padding-bottom: 12px; margin-bottom: 22px; }
  header h1 { font-size: 19px; letter-spacing: -.2px; }
  header .meta { color: #5A6B7B; font-size: 11.5px; margin-top: 4px; }
  .q { border: 1px solid #DDE3EA; border-radius: 10px; padding: 14px 16px; margin-bottom: 14px; page-break-inside: avoid; }
  .qhead { font-weight: 800; font-size: 11.5px; color: #5A6B7B; margin-bottom: 7px; }
  .diff { font-weight: 700; text-transform: capitalize; background: #EEF1F5; border-radius: 100px; padding: 1px 9px; margin-left: 6px; }
  .stem { font-weight: 600; font-size: 13.5px; white-space: pre-wrap; }
  pre { background: #F3F5F9; border: 1px solid #E3E8EF; border-radius: 8px; padding: 10px 12px; font: 11.5px/1.5 ui-monospace, Menlo, monospace; margin-top: 9px; white-space: pre-wrap; word-break: break-word; }
  .diagram { margin-top: 9px; text-align: center; }
  .diagram svg { max-width: 100%; height: auto; }
  .opts { margin-top: 10px; display: flex; flex-direction: column; gap: 6px; }
  .opt { display: flex; gap: 9px; border: 1px solid #E7EBF0; border-radius: 7px; padding: 7px 10px; align-items: flex-start; }
  .opt .letter { font-weight: 800; font-size: 11px; color: #5A6B7B; border: 1.5px solid #C9D2DC; border-radius: 50%; width: 18px; height: 18px; display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; margin-top: 1px; }
  .opt.correct { border-color: #7AB52C; background: #F4FAEC; font-weight: 700; }
  .opt.correct .letter { background: #7AB52C; border-color: #7AB52C; color: #fff; }
  .answer { margin-top: 10px; background: #F6F8FB; border: 1px solid #E7EBF0; border-radius: 7px; padding: 8px 11px; font-size: 12px; color: #3A4A5C; }
  @media print { body { padding: 0; } .q { border-color: #C9D2DC; } }
</style></head><body>
<header>
  <h1>${esc(topic)}</h1>
  <div class="meta">${list.length ? list.length : mcqs.length} questions · ${withAnswers ? "Answer key included" : "Questions only"} · Generated ${new Date().toLocaleDateString()}</div>
</header>
${items}
<script>window.addEventListener("load",function(){setTimeout(function(){window.print()},250)})</script>
</body></html>`;

  const w = window.open("", "_blank");
  if (!w) return false;
  w.document.write(html);
  w.document.close();
  return true;
}
