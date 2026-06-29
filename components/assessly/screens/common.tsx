"use client";

import { C, STAGES, stageIndex, timeAgo } from "../theme";
import { Spinner } from "../ui";
import type { PastRunSummary } from "@/lib/types";
import { runModeLabel, runSourceLabel } from "../store";

export interface RunView {
  id: string;
  title: string;
  modeLabel: string;
  src: string;
  count: number;
  by: string;
  when: string;
  stage: number;
  statusLabel: string;
  awaitingReview: boolean;
  status: string;
}

export function runView(r: PastRunSummary, finalised: boolean, by = "—"): RunView {
  const stage = stageIndex(r.status, finalised);
  const awaitingReview = r.status === "done" && !finalised;
  let statusLabel: string = STAGES[stage] ?? "In progress";
  if (awaitingReview) statusLabel = "Awaiting review";
  if (r.status === "error") statusLabel = "Error";
  return {
    id: r.id,
    title: r.topic || "Untitled set",
    modeLabel: runModeLabel(r),
    src: runSourceLabel(r),
    count: r.count,
    by,
    when: timeAgo(r.started_at),
    stage,
    statusLabel,
    awaitingReview,
    status: r.status,
  };
}

/** A spinning "in progress" pill or a static coloured pill. */
export function StatusPill({ v }: { v: RunView }) {
  if (v.status === "error") {
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, fontWeight: 700, padding: "4px 11px", borderRadius: 100, color: "#C0454B", background: "#FCEBEC" }}>
        Error
      </span>
    );
  }
  if (v.awaitingReview) {
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, fontWeight: 700, padding: "4px 11px", borderRadius: 100, color: "#B0700C", background: "#FBF1E0" }}>
        Awaiting review
      </span>
    );
  }
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 11.5, fontWeight: 700, padding: "4px 11px", borderRadius: 100, color: C.navy, background: "#E8EDF6" }}>
      <Spinner size={11} />
      {v.statusLabel}
    </span>
  );
}

export function TableShell({ cols, header, children }: { cols: string; header: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={{ background: "#fff", border: "1px solid #E9EDF1", borderRadius: 14, overflow: "hidden" }}>
      <div style={{ display: "grid", gridTemplateColumns: cols, alignItems: "center", gap: 14, padding: "15px 24px", background: C.navy }}>{header}</div>
      {children}
    </div>
  );
}

export function Th({ children, dim, right }: { children: React.ReactNode; dim?: boolean; right?: boolean }) {
  return (
    <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: ".4px", color: dim ? "rgba(255,255,255,.72)" : "#fff", textAlign: right ? "right" : "left" }}>
      {children}
    </span>
  );
}

export function EmptyRow({ children }: { children: React.ReactNode }) {
  return <div style={{ padding: 24, textAlign: "center", color: C.faint, fontSize: 13, borderTop: "1px solid #F0F3F6" }}>{children}</div>;
}

export function TitleCell({ title, sub }: { title: string; sub: string }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: C.navy, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{title}</div>
      <div style={{ fontSize: 11.5, color: C.faint, marginTop: 2 }}>{sub}</div>
    </div>
  );
}

export function Cell({ children, bold }: { children: React.ReactNode; bold?: boolean }) {
  return <span style={{ fontSize: 13, color: bold ? C.slate : C.slate2, fontWeight: bold ? 700 : 400, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{children}</span>;
}
