"use client";

// Read-only page for one finalised bank (/finalised/<runId>): the run's
// details and its questions, with no review controls — reviewing happened
// before finalisation. Export lives in the Topbar.

import { useEffect, useState } from "react";
import { C, titleCase, diffStyle } from "../theme";
import { Spinner } from "../ui";
import { IconCheck, IconWarn } from "../icons";
import { useSmartCoGen, runModeLabel, runSourceLabel } from "../store";
import { fetchRun } from "@/lib/api";
import { exclusionReason } from "@/lib/utils";
import type { MCQ } from "@/lib/types";

const LETTERS = ["A", "B", "C", "D", "E", "F"];

/** Prompt fields persisted on the run row (present on newer runs). */
type RunPrompts = { extra_prompt?: string | null; negative_prompt?: string | null };

export function FinalisedRun() {
  const { finalRunId, runs } = useSmartCoGen();
  const [mcqs, setMcqs] = useState<MCQ[] | null>(null);
  const [prompts, setPrompts] = useState<RunPrompts>({});
  const [error, setError] = useState<string | null>(null);

  const meta = runs.find((r) => r.id === finalRunId) ?? null;

  useEffect(() => {
    if (!finalRunId) return;
    let alive = true;
    setMcqs(null);
    setPrompts({});
    setError(null);
    fetchRun(finalRunId)
      .then(({ run, mcqs }) => {
        if (!alive) return;
        setMcqs(mcqs);
        setPrompts(run as RunPrompts);
      })
      .catch((e) => { if (alive) setError(e instanceof Error ? e.message : "Could not load questions"); });
    return () => { alive = false; };
  }, [finalRunId]);

  if (error) {
    return <div style={{ padding: 40, textAlign: "center", color: "#C0454B", fontSize: 13.5, background: "#fff", border: "1px solid #E9EDF1", borderRadius: 14 }}>{error}</div>;
  }
  if (!mcqs) {
    return <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, padding: 60, color: C.muted, fontSize: 13.5 }}><Spinner size={16} /> Loading questions…</div>;
  }

  const usableCount = mcqs.filter((m) => !exclusionReason(m)).length;

  // Same two-column layout as the review page: questions left, sticky meta
  // sidebar right — minus the process timeline and review controls.
  return (
    <div style={{ display: "flex", gap: 28, alignItems: "flex-start", maxWidth: 1280, margin: "0 auto", paddingBottom: 30 }}>
      {/* LEFT: questions */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {mcqs.map((m, i) => <QuestionCard key={m.id ?? i} m={m} n={i + 1} />)}
          {mcqs.length === 0 && (
            <div style={{ padding: "60px 0", textAlign: "center", color: C.faint, fontSize: 13.5 }}>No questions found for this generation.</div>
          )}
        </div>
      </div>

      {/* RIGHT: meta sidebar */}
      <div style={{ width: 344, flexShrink: 0, display: "flex", flexDirection: "column", gap: 14, position: "sticky", top: 0 }}>
        {/* DETAILS */}
        <div style={{ background: "#fff", border: "1px solid #E9EDF1", borderRadius: 14, padding: "18px 19px" }}>
          <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".5px", color: C.slate2, marginBottom: 12 }}>DETAILS</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
            <DetailRow label="Created by" value={meta?.created_by_name ?? "—"} bold />
            <DetailRow label="Source" value={meta ? runSourceLabel(meta) : "—"} ellipsis />
            <DetailRow label="Method" value={meta ? runModeLabel(meta) : "—"} />
            <DetailRow label="Difficulty" value={meta ? titleCase(meta.difficulty) : "—"} />
            <DetailRow label="Generated" value={meta ? new Date(meta.started_at).toLocaleString() : "—"} />
            <DetailRow label="Status" value="Finalised" bold accent />
          </div>
        </div>

        {/* PROMPTS GIVEN — same styling as the review page */}
        <div style={{ background: "#fff", border: "1px solid #E9EDF1", borderRadius: 14, padding: "18px 19px" }}>
          <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".5px", color: C.slate2, marginBottom: 13 }}>PROMPTS GIVEN</div>
          <div style={{ border: "1px solid #DCEAD2", background: "#F6FBF0", borderRadius: 11, padding: "12px 13px", marginBottom: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 6 }}>
              <span style={{ width: 18, height: 18, borderRadius: 6, background: "#E2F0D5", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <svg width="11" height="11" viewBox="0 0 18 18" fill="none" stroke="#4C8A28" strokeWidth={2.4}><path d="M9 4v10M4 9h10" /></svg>
              </span>
              <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".3px", color: "#4C8A28" }}>ADDITIONAL PROMPT</span>
            </div>
            <div style={{ fontSize: 12.5, color: C.slate, lineHeight: 1.5, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{prompts.extra_prompt || "—"}</div>
          </div>
          <div style={{ border: "1px solid #F2D3D5", background: "#FDF4F4", borderRadius: 11, padding: "12px 13px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 6 }}>
              <span style={{ width: 18, height: 18, borderRadius: 6, background: "#F6DADC", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <svg width="11" height="11" viewBox="0 0 18 18" fill="none" stroke="#C0454B" strokeWidth={2.4}><path d="M4 9h10" /></svg>
              </span>
              <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".3px", color: "#C0454B" }}>NEGATIVE PROMPT</span>
            </div>
            <div style={{ fontSize: 12.5, color: C.slate, lineHeight: 1.5, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{prompts.negative_prompt || "—"}</div>
          </div>
        </div>

        {/* Stats strip */}
        <div style={{ background: "#fff", border: "1px solid #E9EDF1", borderRadius: 14, padding: "16px 15px", display: "flex", alignItems: "center", justifyContent: "space-around", textAlign: "center" }}>
          <Stat value={mcqs.length} label="Questions" color={C.navy} />
          <VDivider />
          <Stat value={usableCount} label="Export-ready" color="#2E7D32" />
        </div>
      </div>
    </div>
  );
}

function DetailRow({ label, value, bold, ellipsis, accent }: { label: string; value: string; bold?: boolean; ellipsis?: boolean; accent?: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
      <span style={{ width: 92, flexShrink: 0, fontSize: 12.5, color: C.muted, fontWeight: 600 }}>{label}</span>
      <span style={{ fontSize: 13, color: accent ? "#4C8A28" : C.navy, fontWeight: bold ? 800 : 600, minWidth: 0, ...(ellipsis ? { whiteSpace: "nowrap" as const, overflow: "hidden", textOverflow: "ellipsis" } : {}) }}>{value}</span>
    </div>
  );
}

function Stat({ value, label, color }: { value: number; label: string; color: string }) {
  return (
    <div>
      <div style={{ fontSize: 20, fontWeight: 800, color }}>{value}</div>
      <div style={{ fontSize: 11, color: C.muted, fontWeight: 600, marginTop: 1 }}>{label}</div>
    </div>
  );
}

function VDivider() {
  return <div style={{ width: 1, height: 34, background: "#EDF1F4" }} />;
}

function QuestionCard({ m, n }: { m: MCQ; n: number }) {
  const dd = diffStyle(m.difficulty);
  const excluded = exclusionReason(m);
  return (
    <div style={{ background: "#fff", border: "1px solid #E9EDF1", borderRadius: 14, padding: "20px 24px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 12 }}>
        <span style={{ fontSize: 12.5, fontWeight: 800, color: C.muted }}>Q{n}</span>
        <span style={{ fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 100, color: dd.fg, background: dd.bg }}>{titleCase(m.difficulty)}</span>
        {m.type === "code" && <span style={{ fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 100, color: C.slate2, background: "#EEF1F5" }}>Code</span>}
        {excluded && (
          <span title={excluded} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 100, color: "#B0700C", background: "#FBF1E0" }}>
            <IconWarn s={12} />Excluded from exports — {excluded}
          </span>
        )}
      </div>

      <div style={{ fontSize: 14.5, fontWeight: 600, color: C.navy, lineHeight: 1.55, whiteSpace: "pre-wrap" }}>{m.question}</div>

      {m.snippet?.code && (
        <pre style={{ margin: "12px 0 0", background: "#0E1B33", color: "#DCE6F5", borderRadius: 10, padding: "14px 16px", fontSize: 12.5, lineHeight: 1.55, overflowX: "auto", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>
          {m.snippet.code}
        </pre>
      )}

      {m.image_svg && (
        <div style={{ margin: "12px 0 0", border: "1px solid #EDF1F4", borderRadius: 10, padding: 12, display: "flex", justifyContent: "center", overflowX: "auto" }} dangerouslySetInnerHTML={{ __html: m.image_svg }} />
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 7, marginTop: 14 }}>
        {m.options.map((opt, i) => {
          const correct = i === m.correct_index;
          return (
            <div key={i} style={{ display: "flex", gap: 11, alignItems: "flex-start", padding: "9px 13px", borderRadius: 9, border: `1.5px solid ${correct ? "#BFDDA1" : "#EDF1F4"}`, background: correct ? "#F4FAEC" : "#FAFBFC" }}>
              <span style={{ width: 20, height: 20, borderRadius: "50%", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 800, color: correct ? "#fff" : C.slate2, background: correct ? "#7AB52C" : "#E9EDF1", marginTop: 1 }}>
                {correct ? <IconCheck s={11} stroke="#fff" sw={2.6} /> : LETTERS[i]}
              </span>
              <span style={{ fontSize: 13.5, color: C.navy, lineHeight: 1.5, whiteSpace: "pre-wrap", fontWeight: correct ? 700 : 500 }}>{opt}</span>
            </div>
          );
        })}
      </div>

      {m.explanation && (
        <div style={{ marginTop: 13, padding: "11px 14px", background: "#F6F8FB", border: "1px solid #EDF1F4", borderRadius: 9, fontSize: 12.5, color: C.slate, lineHeight: 1.55 }}>
          <span style={{ fontWeight: 800, color: C.slate2, marginRight: 6 }}>Why:</span>{m.explanation}
        </div>
      )}
    </div>
  );
}
