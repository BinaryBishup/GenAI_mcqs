"use client";

import { useState } from "react";
import { C } from "./theme";
import { HBox, HBtn } from "./ui";
import { IconDoc, IconDocCheck, IconDownload, IconSheet } from "./icons";
import { useSmartCoGen } from "./store";
import { fetchRun } from "@/lib/api";
import { downloadMCQs, flaggedCount } from "@/lib/export/download";
import { exportPdf } from "@/lib/export/pdf";

type ExportKind = "excel" | "pdf-answers" | "pdf-questions";

const OPTIONS: Array<{ kind: ExportKind; label: string; icon: React.ReactNode }> = [
  { kind: "excel", label: "Excel", icon: <IconSheet s={17} stroke="#2E7D46" sw={1.6} /> },
  { kind: "pdf-answers", label: "PDF with Answers", icon: <IconDocCheck s={17} stroke="#C0454B" sw={1.6} /> },
  { kind: "pdf-questions", label: "Questions PDF", icon: <IconDoc s={17} stroke="#C0454B" sw={1.6} /> },
];

/**
 * Export button for a finalised run. Excel = the Mettl bulk-upload .xlsx;
 * the PDF options print via the browser (Save as PDF). Flagged questions
 * (failed plagiarism / code-verify / answer-check) are excluded everywhere.
 */
export function ExportMenu({ runId, topic, compact }: { runId: string; topic: string; compact?: boolean }) {
  const { toast } = useSmartCoGen();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const doExport = async (kind: ExportKind) => {
    if (busy) return;
    setBusy(true);
    setOpen(false);
    try {
      const { mcqs } = await fetchRun(runId);
      if (!mcqs.length) { toast("This generation has no questions to export"); return; }
      if (kind === "excel") {
        downloadMCQs(mcqs, "mettl", topic);
        const excluded = flaggedCount(mcqs);
        toast(excluded > 0 ? `Exported ${mcqs.length - excluded} questions (${excluded} flagged excluded)` : `Exported ${mcqs.length} questions`);
      } else {
        const ok = exportPdf(mcqs, topic, kind === "pdf-answers");
        if (!ok) toast("Pop-up blocked — allow pop-ups to export PDF");
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : "Export failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <span style={{ position: "relative", display: "inline-flex" }} onClick={(e) => e.stopPropagation()}>
      <HBtn
        onClick={() => setOpen((v) => !v)}
        style={{ height: compact ? 30 : 36, padding: compact ? "0 10px" : "0 13px", display: "inline-flex", alignItems: "center", gap: 6, background: "#fff", color: busy ? C.muted : C.navy, border: `1.5px solid ${C.navy}`, borderRadius: compact ? 8 : 9, fontSize: 12.5, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}
        hover={{ background: "#F0F4FB" }}
        title="Export questions"
      >
        <IconDownload s={14} sw={1.9} />
        {busy ? "Exporting…" : "Export"}
      </HBtn>

      {open && (
        // Fixed overlay (like TagModal) so the picker never clips inside
        // overflow-hidden table shells.
        <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(16,24,40,.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 120, padding: 24 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: 260, maxWidth: "100%", background: "#fff", borderRadius: 14, padding: 8, boxShadow: "0 24px 60px rgba(16,24,40,.3)" }}>
            <div style={{ padding: "8px 12px 6px", fontSize: 11, fontWeight: 800, letterSpacing: ".5px", color: C.muted }}>EXPORT AS</div>
            {OPTIONS.map((o) => (
              <HBox key={o.kind} onClick={() => doExport(o.kind)} style={{ display: "flex", alignItems: "center", gap: 11, padding: "11px 12px", borderRadius: 9, cursor: "pointer" }} hover={{ background: "#F5F7FA" }}>
                {o.icon}
                <span style={{ fontSize: 13.5, fontWeight: 700, color: C.navy }}>{o.label}</span>
              </HBox>
            ))}
          </div>
        </div>
      )}
    </span>
  );
}
