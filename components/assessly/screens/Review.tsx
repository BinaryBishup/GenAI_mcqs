"use client";

// The Review board — the human-in-the-loop gate between generation and the bank.
// Left column: the generated questions as cards (read + inline-edit), each with
// approve / edit / edit-with-AI / too-similar / reject actions. Right rail: the
// generation-process tracker, run details, the prompts given, and a live stats
// strip. Four modals (AI edit, reject, too-similar) render inline.
//
// Everything is inline-styled to match the Assessly design pixel-for-pixel.

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { C, STAGES, optView, stageIndex, stageView, timeAgo } from "../theme";
import { HBtn, HInput, HTextarea, Spinner } from "../ui";
import { IconCheck, IconInfo, IconPencil, IconSpark, IconWarn, IconX, IconXCircle } from "../icons";
import { useAssessly } from "../store";
import { aiModifyMcq, fetchRun, fetchRunEvents, fetchTopic, regenMcqImage, setMcqReview, updateMcq } from "@/lib/api";
import { downloadMCQs, downloadQuestionsPdf } from "@/lib/download";
import type { Difficulty, MCQ, PastRunSummary } from "@/lib/types";

type ReviewStatus = "pending" | "approved" | "rejected" | "duplicate";

interface DupMatch {
  label: string;
  text: string;
}

interface ReviewItem {
  index: number; // original index in the run (stable; used for backend calls)
  mcq: MCQ;
  status: ReviewStatus;
  rejectReason: string;
  dupNote: string;
  dupMatches: DupMatch[];
}

/** A flattened sample-bank question, used as a duplicate candidate. */
interface BankRow {
  difficulty: Difficulty;
  question: string;
  options: string[];
  correct_index: number;
  code: string | null;
}

type RunRecord = PastRunSummary & { status: string };

/** A passing MCQ defaults to approved; a flagged one waits for a human. */
function defaultStatus(m: MCQ): ReviewStatus {
  const ac = m.answer_check_status;
  const answerBad = ac === "disagree" || ac === "uncertain";
  const plagBad = m.plag_status === "flagged" || m.plag_status === "gave_up";
  return answerBad || plagBad ? "pending" : "approved";
}

const LETTERS = ["A", "B", "C", "D", "E", "F"];

export function Review() {
  const { reviewRunId, runs, setReviewBar, markFinalised, go, toast, user } = useAssessly();

  const [run, setRun] = useState<RunRecord | null>(null);
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [loading, setLoading] = useState(true);

  // inline-edit state
  const [editIdx, setEditIdx] = useState<number | null>(null);
  const [editStem, setEditStem] = useState("");
  const [editOpts, setEditOpts] = useState<string[]>([]);
  const [editCorrect, setEditCorrect] = useState(0);

  // AI-edit modal
  const [aiOpen, setAiOpen] = useState(false);
  const [aiIdx, setAiIdx] = useState<number | null>(null);
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiBusy, setAiBusy] = useState(false);

  // image-edit modal
  const [imgOpen, setImgOpen] = useState(false);
  const [imgIdx, setImgIdx] = useState<number | null>(null);
  const [imgPrompt, setImgPrompt] = useState("");
  const [imgBusy, setImgBusy] = useState(false);

  // reject modal
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectIdx, setRejectIdx] = useState<number | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  // too-similar modal
  const [dupOpen, setDupOpen] = useState(false);
  const [dupIdx, setDupIdx] = useState<number | null>(null);
  const [dupSel, setDupSel] = useState<Set<number>>(new Set()); // selected generation indices
  const [bankSel, setBankSel] = useState<Set<number>>(new Set()); // selected bank-row indices
  const [bankRows, setBankRows] = useState<BankRow[]>([]);
  const [bankLoading, setBankLoading] = useState(false);
  const bankCacheRef = useRef<Map<string, BankRow[]>>(new Map());

  // -------- load run + events --------
  useEffect(() => {
    if (!reviewRunId) return;
    let alive = true;
    setLoading(true);
    setEditIdx(null);
    (async () => {
      try {
        const [{ run: r, mcqs }] = await Promise.all([
          fetchRun(reviewRunId),
          fetchRunEvents(reviewRunId).catch(() => ({ events: [] })),
        ]);
        if (!alive) return;
        setRun(r);
        setItems(
          mcqs.map((mcq, i) => ({
            index: i,
            mcq,
            // Persisted human decision wins; otherwise derive a sensible default.
            status: (mcq.review_status as ReviewStatus | null) ?? defaultStatus(mcq),
            rejectReason: "",
            dupNote: "",
            dupMatches: [],
          })),
        );
      } catch {
        /* leave empty; the run row meta still renders from the runs list */
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [reviewRunId]);

  const meta = run ?? runs.find((r) => r.id === reviewRunId) ?? null;

  const counts = useMemo(() => {
    let approved = 0,
      pending = 0,
      duplicate = 0,
      rejected = 0;
    for (const it of items) {
      if (it.status === "approved") approved++;
      else if (it.status === "duplicate") duplicate++;
      else if (it.status === "rejected") rejected++;
      else pending++;
    }
    return { approved, pending, duplicate, rejected };
  }, [items]);

  // -------- topbar bar (Regenerate + Finalise) --------
  useEffect(() => {
    if (!reviewRunId || !meta) {
      setReviewBar(null);
      return;
    }
    // The set we export: approved questions, or (if none marked) everything not
    // rejected/duplicate — so an un-triaged set still exports sensibly.
    const exportList = () => {
      const approved = items.filter((i) => i.status === "approved").map((i) => i.mcq);
      return approved.length
        ? approved
        : items.filter((i) => i.status !== "rejected" && i.status !== "duplicate").map((i) => i.mcq);
    };
    setReviewBar({
      title: meta.topic || "Untitled set",
      difficulty: meta.difficulty,
      approved: counts.approved,
      onRegenerate: () => toast("Regeneration queued"),
      onFinalise: async () => {
        await markFinalised(reviewRunId);
        toast("Finalised to bank");
        go("finalised");
      },
      onExport: () => {
        const list = exportList();
        if (!list.length) { toast("No approved questions to export"); return; }
        downloadMCQs(list, "mettl", meta.topic || "Generated", { includeFlagged: true });
        toast(`Exported ${list.length} question${list.length > 1 ? "s" : ""} (Mettl .xlsx)`);
      },
      onExportPdf: (withAnswers: boolean) => {
        const list = exportList();
        if (!list.length) { toast("No approved questions to export"); return; }
        toast("Building PDF…");
        downloadQuestionsPdf(list, meta.topic || "Generated", withAnswers)
          .then(() => toast(`Exported PDF ${withAnswers ? "with answers" : "(questions only)"}`))
          .catch(() => toast("PDF export failed"));
      },
    });
    return () => setReviewBar(null);
  }, [reviewRunId, meta, items, counts.approved, setReviewBar, markFinalised, go, toast]);

  // -------- load sample-bank candidates when the too-similar modal opens --------
  const sampleKey = (meta?.sample_file_ids ?? []).join("|");
  useEffect(() => {
    if (!dupOpen) return;
    const fileIds = meta?.sample_file_ids ?? [];
    if (fileIds.length === 0) {
      setBankRows([]);
      setBankLoading(false);
      return;
    }
    const cached = bankCacheRef.current.get(sampleKey);
    if (cached) {
      setBankRows(cached);
      setBankLoading(false);
      return;
    }
    let alive = true;
    setBankLoading(true);
    (async () => {
      try {
        const topics = await Promise.all(fileIds.map((f) => fetchTopic(f).catch(() => null)));
        const rows: BankRow[] = [];
        const order: Difficulty[] = ["easy", "medium", "hard"];
        for (const t of topics) {
          if (!t) continue;
          for (const d of order) {
            for (const q of t.by_difficulty[d] ?? []) {
              rows.push({ difficulty: d, question: q.question, options: q.options, correct_index: q.correct_index, code: q.code });
              if (rows.length >= 40) break;
            }
            if (rows.length >= 40) break;
          }
          if (rows.length >= 40) break;
        }
        bankCacheRef.current.set(sampleKey, rows);
        if (alive) setBankRows(rows);
      } catch {
        if (alive) setBankRows([]); // fetch failed — just show the generation column
      } finally {
        if (alive) setBankLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dupOpen, sampleKey]);

  // -------- per-item mutations --------
  const patch = useCallback((idx: number, fn: (it: ReviewItem) => ReviewItem) => {
    setItems((prev) => prev.map((it) => (it.index === idx ? fn(it) : it)));
  }, []);

  // Persist a reviewer decision (optimistic — the UI already updated). Silent on
  // failure; the next poll/reopen reconciles from the server.
  const persistReview = useCallback((idx: number, status: ReviewStatus) => {
    if (!reviewRunId) return;
    setMcqReview(reviewRunId, idx, status).catch(() => {});
  }, [reviewRunId]);

  const onApprove = useCallback(
    (idx: number) => {
      const cur = items.find((i) => i.index === idx);
      const next: ReviewStatus = cur?.status === "approved" ? "pending" : "approved";
      patch(idx, (it) =>
        next === "pending"
          ? { ...it, status: "pending" }
          : { ...it, status: "approved", rejectReason: "", dupNote: "", dupMatches: [] },
      );
      persistReview(idx, next);
    },
    [items, patch, persistReview],
  );

  const openEdit = useCallback((it: ReviewItem) => {
    setEditIdx(it.index);
    setEditStem(it.mcq.question);
    setEditOpts(it.mcq.options.slice());
    setEditCorrect(it.mcq.correct_index);
  }, []);

  const saveEdit = useCallback(async () => {
    if (editIdx === null || !reviewRunId) return;
    const current = items.find((i) => i.index === editIdx);
    if (!current) return;
    const updated: MCQ = { ...current.mcq, question: editStem, options: editOpts, correct_index: editCorrect };
    try {
      const saved = await updateMcq(reviewRunId, editIdx, updated);
      patch(editIdx, (it) => ({ ...it, mcq: saved }));
      toast("Question updated");
    } catch {
      patch(editIdx, (it) => ({ ...it, mcq: updated }));
      toast("Saved locally — sync failed");
    } finally {
      setEditIdx(null);
    }
  }, [editIdx, reviewRunId, items, editStem, editOpts, editCorrect, patch, toast]);

  const applyAi = useCallback(async () => {
    if (aiIdx === null || !reviewRunId) return;
    const current = items.find((i) => i.index === aiIdx);
    if (!current || !aiPrompt.trim()) return;
    setAiBusy(true);
    try {
      const modified = await aiModifyMcq(current.mcq, aiPrompt.trim());
      const saved = await updateMcq(reviewRunId, aiIdx, modified).catch(() => modified);
      patch(aiIdx, (it) => ({ ...it, mcq: saved }));
      toast("Question rewritten");
      setAiOpen(false);
      setAiPrompt("");
    } catch {
      toast("AI rewrite failed");
    } finally {
      setAiBusy(false);
    }
  }, [aiIdx, reviewRunId, items, aiPrompt, patch, toast]);

  const applyImage = useCallback(async (instruction?: string) => {
    if (imgIdx === null || !reviewRunId) return;
    setImgBusy(true);
    try {
      const svg = await regenMcqImage(reviewRunId, imgIdx, instruction);
      patch(imgIdx, (it) => ({ ...it, mcq: { ...it.mcq, image_svg: svg } }));
      toast("Diagram updated");
      setImgOpen(false);
      setImgPrompt("");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Diagram update failed");
    } finally {
      setImgBusy(false);
    }
  }, [imgIdx, reviewRunId, patch, toast]);

  const confirmReject = useCallback(() => {
    if (rejectIdx === null) return;
    patch(rejectIdx, (it) => ({ ...it, status: "rejected", rejectReason: rejectReason.trim() }));
    persistReview(rejectIdx, "rejected");
    setRejectOpen(false);
    toast("Question rejected");
  }, [rejectIdx, rejectReason, patch, persistReview, toast]);

  const confirmDup = useCallback(() => {
    if (dupIdx === null || (dupSel.size === 0 && bankSel.size === 0)) return;
    const genMatches: DupMatch[] = [...dupSel]
      .sort((a, b) => a - b)
      .map((i) => {
        const m = items.find((x) => x.index === i);
        return { label: "Q" + (i + 1), text: m?.mcq.question ?? "" };
      });
    const bankMatches: DupMatch[] = [...bankSel]
      .sort((a, b) => a - b)
      .map((i) => bankRows[i])
      .filter((r): r is BankRow => !!r)
      .map((r) => ({ label: "Bank · " + r.difficulty, text: r.question }));
    patch(dupIdx, (it) => ({ ...it, status: "duplicate", dupMatches: [...genMatches, ...bankMatches] }));
    persistReview(dupIdx, "duplicate");
    setDupOpen(false);
    toast("Flagged as too similar");
  }, [dupIdx, dupSel, bankSel, bankRows, items, patch, persistReview, toast]);

  // demoted (rejected / duplicate) cards sort to the bottom, stable otherwise
  const sorted = useMemo(() => {
    const demoted = (s: ReviewStatus) => s === "rejected" || s === "duplicate";
    return [...items].sort((a, b) => {
      const da = demoted(a.status) ? 1 : 0;
      const db = demoted(b.status) ? 1 : 0;
      if (da !== db) return da - db;
      return a.index - b.index;
    });
  }, [items]);

  if (!reviewRunId) return null;

  // ---- right-rail derived values ----
  const stage = meta ? stageIndex(meta.status, false) : 0;
  const stages = stageView(stage, false);
  const stageLabel = stage < 3 ? STAGES[stage] : "Awaiting your review";
  const sourceLabel = meta && meta.sample_file_ids && meta.sample_file_ids.length ? meta.sample_file_ids.join(", ") : "From scratch";
  const modeLabel = meta && meta.sample_file_ids && meta.sample_file_ids.length ? "From samples" : "From scratch";

  return (
    <div style={{ display: "flex", gap: 28, alignItems: "flex-start", maxWidth: 1280, margin: "0 auto", paddingBottom: 30 }}>
      {/* LEFT: questions */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {loading ? (
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "60px 0", justifyContent: "center", color: C.muted, fontSize: 13.5 }}>
            <Spinner size={16} />
            Loading questions…
          </div>
        ) : items.length === 0 ? (
          <div style={{ padding: "60px 0", textAlign: "center", color: C.faint, fontSize: 13.5 }}>No questions in this run yet.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {sorted.map((it) => (
              <QuestionCard
                key={it.index}
                item={it}
                num={"Q" + (it.index + 1)}
                editing={editIdx === it.index}
                editStem={editStem}
                editOpts={editOpts}
                editCorrect={editCorrect}
                onApprove={() => onApprove(it.index)}
                onEdit={() => openEdit(it)}
                onAiEdit={() => {
                  setAiIdx(it.index);
                  setAiPrompt("");
                  setAiOpen(true);
                }}
                onEditImage={() => {
                  setImgIdx(it.index);
                  setImgPrompt("");
                  setImgOpen(true);
                }}
                onReject={() => {
                  setRejectIdx(it.index);
                  setRejectReason(it.rejectReason);
                  setRejectOpen(true);
                }}
                onDuplicate={() => {
                  setDupIdx(it.index);
                  setDupSel(new Set());
                  setBankSel(new Set());
                  setDupOpen(true);
                }}
                onStem={setEditStem}
                onOptText={(k, v) => setEditOpts((prev) => prev.map((o, j) => (j === k ? v : o)))}
                onPick={setEditCorrect}
                onSaveEdit={saveEdit}
                onCancelEdit={() => setEditIdx(null)}
              />
            ))}
          </div>
        )}
      </div>

      {/* RIGHT: process + meta sidebar */}
      <div style={{ width: 344, flexShrink: 0, display: "flex", flexDirection: "column", gap: 14, position: "sticky", top: 0 }}>
        {/* Generation process */}
        <div style={{ background: "#fff", border: "1px solid #E9EDF1", borderRadius: 14, padding: "18px 19px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 14 }}>
            <span style={{ fontSize: 13, fontWeight: 800, color: C.navy }}>Generation process</span>
            <span style={{ fontSize: 11, fontWeight: 700, padding: "3px 9px", borderRadius: 100, color: "#B0700C", background: "#FBF1E0" }}>{stageLabel}</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            {stages.map((st) => (
              <div key={st.label} style={{ display: "flex", alignItems: "center", gap: 11, padding: "6px 0" }}>
                <div style={{ width: 22, height: 22, borderRadius: "50%", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", background: st.bg, border: `1.5px solid ${st.bd}` }}>
                  {st.spinning ? <Spinner size={11} /> : st.done ? <IconCheck s={12} stroke={C.navy} sw={2.4} /> : null}
                </div>
                <span style={{ fontSize: 13, fontWeight: 600, color: st.fg, textDecoration: st.deco }}>{st.label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* DETAILS */}
        <div style={{ background: "#fff", border: "1px solid #E9EDF1", borderRadius: 14, padding: "18px 19px" }}>
          <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".5px", color: C.slate2, marginBottom: 12 }}>DETAILS</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
            <DetailRow label="Created by" value={user?.name ?? "—"} bold />
            <DetailRow label="Source" value={sourceLabel} ellipsis />
            <DetailRow label="Questions" value={String(items.length)} bold />
            <DetailRow label="Method" value={modeLabel} />
            <DetailRow label="Started" value={meta ? timeAgo(meta.started_at) : "—"} />
          </div>
        </div>

        {/* PROMPTS GIVEN */}
        <div style={{ background: "#fff", border: "1px solid #E9EDF1", borderRadius: 14, padding: "18px 19px" }}>
          <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".5px", color: C.slate2, marginBottom: 13 }}>PROMPTS GIVEN</div>
          <div style={{ border: "1px solid #DCEAD2", background: "#F6FBF0", borderRadius: 11, padding: "12px 13px", marginBottom: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 6 }}>
              <span style={{ width: 18, height: 18, borderRadius: 6, background: "#E2F0D5", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <svg width="11" height="11" viewBox="0 0 18 18" fill="none" stroke="#4C8A28" strokeWidth={2.4}>
                  <path d="M9 4v10M4 9h10" />
                </svg>
              </span>
              <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".3px", color: "#4C8A28" }}>ADDITIONAL PROMPT</span>
            </div>
            <div style={{ fontSize: 12.5, color: C.slate, lineHeight: 1.5, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{meta?.extra_prompt?.trim() || meta?.topic || "—"}</div>
          </div>
          <div style={{ border: "1px solid #F2D3D5", background: "#FDF4F4", borderRadius: 11, padding: "12px 13px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 6 }}>
              <span style={{ width: 18, height: 18, borderRadius: 6, background: "#F6DADC", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <svg width="11" height="11" viewBox="0 0 18 18" fill="none" stroke="#C0454B" strokeWidth={2.4}>
                  <path d="M4 9h10" />
                </svg>
              </span>
              <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".3px", color: "#C0454B" }}>NEGATIVE PROMPT</span>
            </div>
            <div style={{ fontSize: 12.5, color: C.slate, lineHeight: 1.5, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{meta?.negative_prompt?.trim() || "—"}</div>
          </div>
        </div>

        {/* Stats strip */}
        <div style={{ background: "#fff", border: "1px solid #E9EDF1", borderRadius: 14, padding: "16px 15px", display: "flex", alignItems: "center", justifyContent: "space-around", textAlign: "center" }}>
          <Stat value={counts.approved} label="Approved" color="#2E7D32" />
          <Divider />
          <Stat value={counts.pending} label="Pending" color={C.muted} />
          <Divider />
          <Stat value={counts.duplicate} label="Similar" color="#A86A12" />
          <Divider />
          <Stat value={counts.rejected} label="Rejected" color="#C0454B" />
        </div>
      </div>

      {/* ===== AI EDIT MODAL ===== */}
      {aiOpen && aiIdx !== null && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(16,24,40,.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 130, padding: 24 }}>
          <div style={{ width: 560, maxWidth: "100%", background: "#fff", borderRadius: 18, overflow: "hidden", boxShadow: "0 24px 60px rgba(16,24,40,.3)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "20px 24px", borderBottom: "1px solid #EDF1F4" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
                <div style={{ width: 34, height: 34, borderRadius: 10, background: "#E1E8F4", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <IconSpark s={18} stroke={C.navy} sw={1.6} />
                </div>
                <div style={{ fontSize: 16, fontWeight: 800, color: C.navy }}>Edit with AI</div>
              </div>
              <CloseBtn onClick={() => setAiOpen(false)} />
            </div>
            <div style={{ padding: 24 }}>
              <div style={{ background: "#F8F8FD", border: "1px solid #EDF1F4", borderRadius: 11, padding: "13px 15px", fontSize: 13.5, color: C.slate, lineHeight: 1.5, marginBottom: 18 }}>
                {items.find((i) => i.index === aiIdx)?.mcq.question}
              </div>
              <label style={{ fontSize: 12.5, fontWeight: 700, color: C.slate, display: "block", marginBottom: 8 }}>How should AI revise it?</label>
              <HTextarea
                value={aiPrompt}
                onChange={(e) => setAiPrompt(e.target.value)}
                placeholder="e.g. Make the distractors more plausible, raise the difficulty, and reword as a scenario."
                style={{ width: "100%", height: 90, border: "1.5px solid #E3E8ED", borderRadius: 11, padding: "12px 14px", fontSize: 13.5, color: C.navy, lineHeight: 1.5, outline: "none", fontFamily: "inherit", boxSizing: "border-box", resize: "vertical" }}
                focusStyle={{ borderColor: C.navy }}
              />
              <div style={{ display: "flex", gap: 7, marginTop: 12, flexWrap: "wrap" }}>
                {["Make it harder", "Improve distractors", "Reword as scenario"].map((chip) => (
                  <HBox key={chip} onClick={() => setAiPrompt(chip)} style={{ fontSize: 12, fontWeight: 600, color: C.slate, background: "#F0F3F6", borderRadius: 100, padding: "6px 12px", cursor: "pointer" }} hover={{ background: "#E1E8F4" }}>
                    {chip}
                  </HBox>
                ))}
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 9, padding: "16px 24px", borderTop: "1px solid #EDF1F4", background: "#FAFBFC" }}>
              <button onClick={() => setAiOpen(false)} disabled={aiBusy} style={{ height: 42, padding: "0 16px", background: "#fff", border: "1.5px solid #E3E8ED", color: C.slate, borderRadius: 10, fontSize: 13.5, fontWeight: 600, cursor: aiBusy ? "default" : "pointer" }}>
                Cancel
              </button>
              <HBtn onClick={applyAi} disabled={aiBusy || !aiPrompt.trim()} style={{ height: 42, padding: "0 18px", background: C.navy, color: "#fff", border: "none", borderRadius: 10, fontSize: 13.5, fontWeight: 700, cursor: aiBusy || !aiPrompt.trim() ? "default" : "pointer", opacity: aiBusy || !aiPrompt.trim() ? 0.6 : 1, display: "flex", alignItems: "center", gap: 7 }} hover={{ background: C.navyHover }}>
                {aiBusy ? <Spinner size={14} color="#fff" track="rgba(255,255,255,.4)" /> : <IconSpark s={15} sw={1.7} />}
                {aiBusy ? "Rewriting…" : "Rewrite"}
              </HBtn>
            </div>
          </div>
        </div>
      )}

      {/* ===== EDIT DIAGRAM MODAL ===== */}
      {imgOpen && imgIdx !== null && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(16,24,40,.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 130, padding: 24 }}>
          <div style={{ width: 620, maxWidth: "100%", maxHeight: "90vh", background: "#fff", borderRadius: 18, overflow: "hidden", boxShadow: "0 24px 60px rgba(16,24,40,.3)", display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "20px 24px", borderBottom: "1px solid #EDF1F4" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
                <div style={{ width: 34, height: 34, borderRadius: 10, background: "#E1E8F4", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <IconSpark s={18} stroke={C.navy} sw={1.6} />
                </div>
                <div style={{ fontSize: 16, fontWeight: 800, color: C.navy }}>Edit diagram</div>
              </div>
              <CloseBtn onClick={() => setImgOpen(false)} />
            </div>
            <div style={{ padding: 24, overflowY: "auto" }}>
              {items.find((i) => i.index === imgIdx)?.mcq.image_svg && (
                <div style={{ padding: 12, background: "#fff", border: "1px solid #E9EDF1", borderRadius: 10, overflowX: "auto", marginBottom: 16, maxHeight: 260 }} dangerouslySetInnerHTML={{ __html: items.find((i) => i.index === imgIdx)!.mcq.image_svg! }} />
              )}
              <label style={{ fontSize: 12.5, fontWeight: 700, color: C.slate, display: "block", marginBottom: 8 }}>How should the diagram change?</label>
              <HTextarea
                value={imgPrompt}
                onChange={(e) => setImgPrompt(e.target.value)}
                placeholder="e.g. Move the labels so no text overlaps the arrows; make the nodes bigger; use a vertical layout."
                style={{ width: "100%", height: 84, border: "1.5px solid #E3E8ED", borderRadius: 11, padding: "12px 14px", fontSize: 13.5, color: C.navy, lineHeight: 1.5, outline: "none", fontFamily: "inherit", boxSizing: "border-box", resize: "vertical" }}
                focusStyle={{ borderColor: C.navy }}
              />
              <div style={{ display: "flex", gap: 7, marginTop: 12, flexWrap: "wrap" }}>
                {["Fix hidden/overlapping text", "Make labels bigger", "Simplify the layout", "Add clearer labels"].map((chip) => (
                  <HBox key={chip} onClick={() => setImgPrompt(chip)} style={{ fontSize: 12, fontWeight: 600, color: C.slate, background: "#F0F3F6", borderRadius: 100, padding: "6px 12px", cursor: "pointer" }} hover={{ background: "#E1E8F4" }}>
                    {chip}
                  </HBox>
                ))}
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "16px 24px", borderTop: "1px solid #EDF1F4", background: "#FAFBFC" }}>
              <HBtn onClick={() => applyImage()} disabled={imgBusy} style={{ height: 42, padding: "0 14px", background: "#fff", border: "1.5px solid #E3E8ED", color: C.slate, borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: imgBusy ? "default" : "pointer", display: "flex", alignItems: "center", gap: 7 }} hover={{ borderColor: C.navy, color: C.navy }}>
                Redraw for clarity
              </HBtn>
              <div style={{ flex: 1 }} />
              <button onClick={() => setImgOpen(false)} disabled={imgBusy} style={{ height: 42, padding: "0 16px", background: "#fff", border: "1.5px solid #E3E8ED", color: C.slate, borderRadius: 10, fontSize: 13.5, fontWeight: 600, cursor: imgBusy ? "default" : "pointer" }}>
                Cancel
              </button>
              <HBtn onClick={() => applyImage(imgPrompt.trim())} disabled={imgBusy || !imgPrompt.trim()} style={{ height: 42, padding: "0 18px", background: C.navy, color: "#fff", border: "none", borderRadius: 10, fontSize: 13.5, fontWeight: 700, cursor: imgBusy || !imgPrompt.trim() ? "default" : "pointer", opacity: imgBusy || !imgPrompt.trim() ? 0.6 : 1, display: "flex", alignItems: "center", gap: 7 }} hover={{ background: C.navyHover }}>
                {imgBusy ? <Spinner size={14} color="#fff" track="rgba(255,255,255,.4)" /> : <IconSpark s={15} sw={1.7} />}
                {imgBusy ? "Updating…" : "Apply change"}
              </HBtn>
            </div>
          </div>
        </div>
      )}

      {/* ===== REJECT FEEDBACK MODAL ===== */}
      {rejectOpen && rejectIdx !== null && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(16,24,40,.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 135, padding: 24 }}>
          <div style={{ width: 520, maxWidth: "100%", background: "#fff", borderRadius: 18, overflow: "hidden", boxShadow: "0 24px 60px rgba(16,24,40,.3)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "20px 24px", borderBottom: "1px solid #EDF1F4" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
                <div style={{ width: 34, height: 34, borderRadius: 10, background: "#FCEBEC", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <IconXCircle s={18} stroke="#C0454B" />
                </div>
                <div style={{ fontSize: 16, fontWeight: 800, color: C.navy }}>Reject question</div>
              </div>
              <CloseBtn onClick={() => setRejectOpen(false)} />
            </div>
            <div style={{ padding: "22px 24px" }}>
              <div style={{ background: "#F8F8FD", border: "1px solid #EDF1F4", borderRadius: 11, padding: "13px 15px", fontSize: 13.5, color: C.slate, lineHeight: 1.5, marginBottom: 18 }}>
                {items.find((i) => i.index === rejectIdx)?.mcq.question}
              </div>
              <label style={{ fontSize: 12.5, fontWeight: 700, color: C.slate, display: "block", marginBottom: 8 }}>
                Why are you rejecting this? <span style={{ color: C.faint, fontWeight: 500 }}>· feedback sharpens the regeneration</span>
              </label>
              <HTextarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="e.g. The correct answer is debatable and two distractors are obviously wrong."
                style={{ width: "100%", height: 96, border: "1.5px solid #E3E8ED", borderRadius: 11, padding: "12px 14px", fontSize: 13.5, color: C.navy, lineHeight: 1.5, outline: "none", fontFamily: "inherit", boxSizing: "border-box", resize: "vertical" }}
                focusStyle={{ borderColor: "#C0454B" }}
              />
              <div style={{ display: "flex", gap: 7, marginTop: 12, flexWrap: "wrap" }}>
                {["Ambiguous answer", "Weak distractors", "Off-topic", "Too easy"].map((chip) => (
                  <HBox key={chip} onClick={() => setRejectReason(chip)} style={{ fontSize: 12, fontWeight: 600, color: C.slate, background: "#F0F3F6", borderRadius: 100, padding: "6px 12px", cursor: "pointer" }} hover={{ background: "#FCEBEC", color: "#C0454B" }}>
                    {chip}
                  </HBox>
                ))}
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 9, padding: "16px 24px", borderTop: "1px solid #EDF1F4", background: "#FAFBFC" }}>
              <button onClick={() => setRejectOpen(false)} style={{ height: 42, padding: "0 16px", background: "#fff", border: "1.5px solid #E3E8ED", color: C.slate, borderRadius: 10, fontSize: 13.5, fontWeight: 600, cursor: "pointer" }}>
                Cancel
              </button>
              <HBtn onClick={confirmReject} style={{ height: 42, padding: "0 18px", background: "#C0454B", color: "#fff", border: "none", borderRadius: 10, fontSize: 13.5, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 7 }} hover={{ background: "#A53A40" }}>
                <IconX s={15} sw={2} />
                Reject &amp; move down
              </HBtn>
            </div>
          </div>
        </div>
      )}

      {/* ===== TOO SIMILAR (DUPLICATE) MODAL ===== */}
      {dupOpen && dupIdx !== null && (
        <div onClick={() => setDupOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(16,24,40,.5)", display: "flex", flexDirection: "column", justifyContent: "flex-end", zIndex: 135 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", height: "93vh", maxHeight: 980, background: "#fff", borderRadius: "20px 20px 0 0", overflow: "hidden", boxShadow: "0 -18px 50px rgba(16,24,40,.28)", display: "flex", flexDirection: "column" }}>
            <div style={{ flexShrink: 0, display: "flex", justifyContent: "center", padding: "9px 0 2px" }}>
              <div style={{ width: 42, height: 4, borderRadius: 100, background: "#DCE2E8" }} />
            </div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "11px 30px 16px", borderBottom: "1px solid #EDF1F4", flexShrink: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
                <div style={{ width: 36, height: 36, borderRadius: 10, background: "#FBF1E0", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <IconWarn s={19} stroke="#A86A12" />
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 16.5, fontWeight: 800, color: C.navy }}>Flag as too similar</div>
                  <div style={{ fontSize: 12.5, color: C.muted, marginTop: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>Select the questions this one duplicates — from this generation or the sample bank.</div>
                </div>
              </div>
              <CloseBtn onClick={() => setDupOpen(false)} size={36} />
            </div>
            <div style={{ flex: 1, overflow: "hidden", display: "flex", minHeight: 0 }}>
              {/* LEFT: the question being flagged (read-only) */}
              {(() => {
                const flagged = items.find((i) => i.index === dupIdx);
                return (
                  <div style={{ width: "42%", flexShrink: 0, borderRight: "1px solid #EDF1F4", background: "#FFFCF4", display: "flex", flexDirection: "column", minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "15px 26px 11px", flexShrink: 0 }}>
                      <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#A86A12" }} />
                      <span style={{ fontSize: 11.5, fontWeight: 800, letterSpacing: ".4px", color: "#A86A12" }}>FLAGGING THIS QUESTION</span>
                    </div>
                    <div style={{ flex: 1, overflowY: "auto", padding: "0 26px 22px", minHeight: 0 }}>
                      {flagged && (
                        <>
                          <div style={{ fontSize: 11, fontWeight: 800, color: C.faint, marginBottom: 6 }}>{"Q" + (flagged.index + 1)}</div>
                          <div style={{ fontSize: 14, fontWeight: 700, color: C.navy, lineHeight: 1.45 }}>{flagged.mcq.question}</div>
                          {flagged.mcq.snippet && (
                            <pre className="mono" style={{ background: C.codeBg, borderRadius: 8, padding: "11px 13px", fontSize: 11.5, color: C.codeFg, lineHeight: 1.55, overflowX: "auto", marginTop: 11 }}>
                              {flagged.mcq.snippet.code}
                            </pre>
                          )}
                          <div style={{ display: "flex", flexDirection: "column", gap: 7, marginTop: 13 }}>
                            {optView(flagged.mcq.options, flagged.mcq.correct_index, false, true).map((o, k) => (
                              <div key={k} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 11px", borderRadius: 8, fontSize: 12.5, color: o.fg, background: o.bg, border: `1px solid ${o.bd}` }}>
                                <div style={{ width: 17, height: 17, borderRadius: "50%", border: `1.5px solid ${o.dotBd}`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, color: o.dotFg, fontSize: 10, fontWeight: 700 }}>{o.letter}</div>
                                <span>{o.text}</span>
                              </div>
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                );
              })()}

              {/* RIGHT: candidates to flag against */}
              <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", padding: "0 28px 18px" }}>
                  {/* Group 1 — this generation */}
                  <GroupLabel dot={C.navy} color={C.navy} label="THIS GENERATION" note="· other questions in this run" />
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {items
                      .filter((x) => x.index !== dupIdx)
                      .map((x) => (
                        <CandidateRow
                          key={"g" + x.index}
                          label={"Q" + (x.index + 1)}
                          stem={x.mcq.question}
                          code={x.mcq.snippet?.code ?? null}
                          options={x.mcq.options}
                          correct={x.mcq.correct_index}
                          selected={dupSel.has(x.index)}
                          onToggle={() =>
                            setDupSel((prev) => {
                              const next = new Set(prev);
                              if (next.has(x.index)) next.delete(x.index);
                              else next.add(x.index);
                              return next;
                            })
                          }
                        />
                      ))}
                    {items.filter((x) => x.index !== dupIdx).length === 0 && (
                      <div style={{ padding: "22px 0", textAlign: "center", color: C.faint, fontSize: 13 }}>No other generated questions to compare against.</div>
                    )}
                  </div>

                  {/* Group 2 — sample bank */}
                  <div style={{ marginTop: 18 }}>
                    <GroupLabel dot="#A86A12" color="#A86A12" label="SAMPLE BANK" note="· source question banks" />
                    {bankLoading ? (
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 9, padding: "26px 0", color: C.muted, fontSize: 13 }}>
                        <Spinner size={15} />
                        Loading bank questions…
                      </div>
                    ) : bankRows.length === 0 ? (
                      <div style={{ padding: "22px 0", textAlign: "center", color: C.faint, fontSize: 13 }}>No sample-bank questions to compare against.</div>
                    ) : (
                      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        {bankRows.map((r, bi) => (
                          <CandidateRow
                            key={"b" + bi}
                            label={"Bank · " + r.difficulty}
                            stem={r.question}
                            code={r.code}
                            options={r.options}
                            correct={r.correct_index}
                            selected={bankSel.has(bi)}
                            onToggle={() =>
                              setBankSel((prev) => {
                                const next = new Set(prev);
                                if (next.has(bi)) next.delete(bi);
                                else next.add(bi);
                                return next;
                              })
                            }
                          />
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "15px 30px", borderTop: "1px solid #EDF1F4", background: "#FAFBFC", flexShrink: 0 }}>
              <span style={{ fontSize: 12.5, color: C.muted, fontWeight: 600 }}>{dupSel.size + bankSel.size} selected</span>
              <div style={{ flex: 1 }} />
              <button onClick={() => setDupOpen(false)} style={{ height: 42, padding: "0 16px", background: "#fff", border: "1.5px solid #E3E8ED", color: C.slate, borderRadius: 10, fontSize: 13.5, fontWeight: 600, cursor: "pointer" }}>
                Cancel
              </button>
              {dupSel.size + bankSel.size > 0 ? (
                <HBtn onClick={confirmDup} style={{ height: 42, padding: "0 18px", background: "#A86A12", color: "#fff", border: "none", borderRadius: 10, fontSize: 13.5, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 7 }} hover={{ background: "#8E5810" }}>
                  <IconWarn s={15} sw={2} />
                  Flag &amp; move down
                </HBtn>
              ) : (
                <button disabled style={{ height: 42, padding: "0 18px", background: "#E8E3D6", color: "#B6A988", border: "none", borderRadius: 10, fontSize: 13.5, fontWeight: 700, cursor: "not-allowed", display: "flex", alignItems: "center", gap: 7 }}>
                  <IconWarn s={15} sw={2} />
                  Flag &amp; move down
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================ sub-components ============================

function HBox({ children, style, hover, onClick }: { children: React.ReactNode; style?: React.CSSProperties; hover?: React.CSSProperties; onClick?: () => void }) {
  const [h, setH] = useState(false);
  return (
    <div onClick={onClick} onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)} style={{ ...style, ...(h && hover ? hover : null) }}>
      {children}
    </div>
  );
}

function GroupLabel({ dot, color, label, note }: { dot: string; color: string; label: string; note: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "15px 0 11px", position: "sticky", top: 0, background: "#fff", zIndex: 1 }}>
      <span style={{ width: 7, height: 7, borderRadius: "50%", background: dot }} />
      <span style={{ fontSize: 11.5, fontWeight: 800, letterSpacing: ".4px", color }}>{label}</span>
      <span style={{ fontSize: 11, color: C.muted, fontWeight: 600 }}>{note}</span>
    </div>
  );
}

function CandidateRow({ label, stem, code, options, correct, selected, onToggle }: { label: string; stem: string; code: string | null; options: string[]; correct: number; selected: boolean; onToggle: () => void }) {
  return (
    <div
      onClick={onToggle}
      style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "14px 15px", borderRadius: 12, cursor: "pointer", border: `1.5px solid ${selected ? "#E0AE4E" : "#E9EDF1"}`, background: selected ? "#FFFCF4" : "#fff" }}
    >
      <div style={{ width: 19, height: 19, borderRadius: 6, flexShrink: 0, marginTop: 1, border: `1.5px solid ${selected ? "#A86A12" : "#CBD5E0"}`, background: selected ? "#A86A12" : "#fff", display: "flex", alignItems: "center", justifyContent: "center" }}>
        {selected && <IconCheck s={12} stroke="#fff" sw={2.6} />}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 11, fontWeight: 800, color: C.faint, marginBottom: 5 }}>{label}</div>
        <div style={{ fontSize: 13.5, fontWeight: 700, color: C.navy, lineHeight: 1.42 }}>{stem}</div>
        {code && (
          <pre className="mono" style={{ background: C.codeBg, borderRadius: 8, padding: "10px 12px", fontSize: 11.5, color: C.codeFg, lineHeight: 1.55, overflowX: "auto", marginTop: 9 }}>
            {code}
          </pre>
        )}
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 10 }}>
          {optView(options, correct, false, true).map((o, k) => (
            <div key={k} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 10px", borderRadius: 8, fontSize: 12.5, color: o.fg, background: o.bg, border: `1px solid ${o.bd}` }}>
              <div style={{ width: 17, height: 17, borderRadius: "50%", border: `1.5px solid ${o.dotBd}`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, color: o.dotFg, fontSize: 10, fontWeight: 700 }}>{o.letter}</div>
              <span>{o.text}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function CloseBtn({ onClick, size = 34 }: { onClick: () => void; size?: number }) {
  return (
    <HBox onClick={onClick} style={{ width: size, height: size, borderRadius: 9, background: "#F4F6F8", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0 }} hover={{ background: "#E9EDF1" }}>
      <IconX s={16} stroke={C.slate} sw={2} />
    </HBox>
  );
}

function DetailRow({ label, value, bold, ellipsis }: { label: string; value: string; bold?: boolean; ellipsis?: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
      <span style={{ fontSize: 12.5, color: C.muted }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: bold ? 700 : 600, color: bold ? C.navy : C.slate, textAlign: "right", ...(ellipsis ? { maxWidth: 200, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } : null) }}>{value}</span>
    </div>
  );
}

function Stat({ value, label, color }: { value: number; label: string; color: string }) {
  return (
    <div>
      <div style={{ fontSize: 21, fontWeight: 800, color }}>{value}</div>
      <div style={{ fontSize: 11, color: C.muted, marginTop: 1 }}>{label}</div>
    </div>
  );
}

function Divider() {
  return <div style={{ width: 1, height: 30, background: "#EDF1F4" }} />;
}

interface CardProps {
  item: ReviewItem;
  num: string;
  editing: boolean;
  editStem: string;
  editOpts: string[];
  editCorrect: number;
  onApprove: () => void;
  onEdit: () => void;
  onAiEdit: () => void;
  onEditImage: () => void;
  onReject: () => void;
  onDuplicate: () => void;
  onStem: (v: string) => void;
  onOptText: (k: number, v: string) => void;
  onPick: (k: number) => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
}

function QuestionCard(p: CardProps) {
  const { item, editing } = p;
  const { mcq, status } = item;
  const approved = status === "approved";
  const rejected = status === "rejected";
  const duplicate = status === "duplicate";
  const demoted = rejected || duplicate;

  const cardBd = editing ? C.navy : rejected ? "#E7A3A8" : duplicate ? "#E8C36B" : approved ? "#B6DCA0" : "#E9EDF1";
  const cardBg = rejected ? "#FFF8F8" : duplicate ? "#FFFBF1" : "#fff";

  const opts = optView(mcq.options, mcq.correct_index, false, true);

  return (
    <div style={{ background: cardBg, border: `1.5px solid ${cardBd}`, borderRadius: 14, padding: "18px 20px" }}>
      {/* header */}
      <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 11 }}>
        <span style={{ fontSize: 12, fontWeight: 800, color: C.faint, letterSpacing: ".3px" }}>{p.num}</span>
        <div style={{ flex: 1 }} />
        {approved && <span style={{ fontSize: 11.5, fontWeight: 700, padding: "3px 10px", borderRadius: 100, color: "#2E7D32", background: "#EAF6E4" }}>✓ Approved</span>}
        {duplicate && <span style={{ fontSize: 11.5, fontWeight: 700, padding: "3px 10px", borderRadius: 100, color: "#A86A12", background: "#FBF1E0" }}>⚠ Too similar</span>}
        {rejected && <span style={{ fontSize: 11.5, fontWeight: 700, padding: "3px 10px", borderRadius: 100, color: "#C0454B", background: "#FCEBEC" }}>✕ Rejected</span>}
      </div>

      {editing ? (
        /* ---- INLINE EDIT MODE ---- */
        <>
          <label style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".4px", color: C.slate2, display: "block", marginBottom: 7 }}>QUESTION</label>
          <HTextarea
            value={p.editStem}
            onChange={(e) => p.onStem(e.target.value)}
            style={{ width: "100%", minHeight: 62, resize: "vertical", border: "1.5px solid #CFDBEC", borderRadius: 10, padding: "11px 13px", fontSize: 14.5, fontWeight: 600, color: C.navy, fontFamily: "inherit", lineHeight: 1.45, boxSizing: "border-box" }}
            focusStyle={{ borderColor: C.navy }}
          />
          <label style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".4px", color: C.slate2, display: "block", margin: "15px 0 7px" }}>
            OPTIONS <span style={{ fontWeight: 600, color: C.faint }}>· tap the circle to mark the correct answer</span>
          </label>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {p.editOpts.map((text, k) => {
              const checked = p.editCorrect === k;
              return (
                <div key={k} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div onClick={() => p.onPick(k)} style={{ width: 22, height: 22, borderRadius: "50%", border: `2px solid ${checked ? "#2E7D32" : "#CBD5E0"}`, background: checked ? "#2E7D32" : "#fff", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, cursor: "pointer" }}>
                    {checked && <IconCheck s={12} stroke="#fff" sw={2.6} />}
                  </div>
                  <span style={{ fontSize: 12, fontWeight: 700, color: "#8593A0", width: 14 }}>{LETTERS[k]}</span>
                  <HInput value={text} onChange={(e) => p.onOptText(k, e.target.value)} style={{ flex: 1, height: 40, border: "1.5px solid #E3E8ED", borderRadius: 9, padding: "0 12px", fontSize: 13.5, color: C.navy, fontFamily: "inherit", boxSizing: "border-box" }} focusStyle={{ borderColor: C.navy }} />
                </div>
              );
            })}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 9, marginTop: 16, paddingTop: 14, borderTop: "1px solid #F0F3F6" }}>
            <HBtn onClick={p.onSaveEdit} style={{ height: 38, padding: "0 18px", borderRadius: 9, border: "none", background: C.navy, color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 7 }} hover={{ background: C.navyHover }}>
              <IconCheck s={14} sw={2.2} />
              Save changes
            </HBtn>
            <HBtn onClick={p.onCancelEdit} style={{ height: 38, padding: "0 16px", borderRadius: 9, border: "1.5px solid #E3E8ED", background: "#fff", color: C.slate, fontSize: 13, fontWeight: 600, cursor: "pointer" }} hover={{ borderColor: "#C8D2DC" }}>
              Cancel
            </HBtn>
          </div>
        </>
      ) : (
        /* ---- READ MODE ---- */
        <>
          <div style={{ fontSize: 14.5, fontWeight: 700, color: C.navy, lineHeight: 1.45 }}>{mcq.question}</div>
          {mcq.image_svg && (
            <div style={{ position: "relative", margin: "12px 0" }}>
              <div
                style={{ padding: 12, background: "#fff", border: "1px solid #E9EDF1", borderRadius: 10, overflowX: "auto" }}
                dangerouslySetInnerHTML={{ __html: mcq.image_svg }}
              />
              <HBtn
                onClick={p.onEditImage}
                style={{ position: "absolute", top: 8, right: 8, height: 28, padding: "0 11px", background: "#fff", border: "1.5px solid #E3E8ED", color: C.navy, borderRadius: 8, fontSize: 11.5, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 6, boxShadow: "0 1px 3px rgba(16,24,40,.08)" }}
                hover={{ borderColor: C.navy, background: "#F4F7FC" }}
              >
                <IconSpark s={13} sw={1.7} />
                Edit diagram
              </HBtn>
            </div>
          )}
          {mcq.snippet && (
            <pre className="mono" style={{ background: C.codeBg, borderRadius: 9, padding: "13px 15px", fontSize: 12.5, color: C.codeFg, lineHeight: 1.6, overflowX: "auto", marginTop: 11 }}>
              {mcq.snippet.code}
            </pre>
          )}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 12 }}>
            {opts.map((o, k) => (
              <div key={k} style={{ display: "flex", alignItems: "center", gap: 9, padding: "9px 11px", borderRadius: 9, fontSize: 13, color: o.fg, background: o.bg, border: `1px solid ${o.bd}` }}>
                <div style={{ width: 18, height: 18, borderRadius: "50%", border: `1.5px solid ${o.dotBd}`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, color: o.dotFg, fontSize: 11, fontWeight: 700 }}>{o.letter}</div>
                <span>{o.text}</span>
              </div>
            ))}
          </div>
          {mcq.explanation && (
            <div style={{ display: "flex", alignItems: "flex-start", gap: 8, marginTop: 12, padding: "10px 12px", background: "#F8F8FD", border: "1px solid #E6E7F7", borderRadius: 10 }}>
              <IconInfo s={15} stroke={C.navy} sw={1.7} style={{ flexShrink: 0, marginTop: 1 }} />
              <span style={{ fontSize: 12.5, color: C.slate2, lineHeight: 1.5 }}>
                <b style={{ color: C.navy }}>Why:</b> {mcq.explanation}
              </span>
            </div>
          )}

          {rejected && (
            <div style={{ display: "flex", alignItems: "flex-start", gap: 9, marginTop: 12, padding: "11px 13px", background: "#FCEBEC", border: "1px solid #F2C4C8", borderRadius: 10 }}>
              <IconXCircle s={16} stroke="#C0454B" sw={1.8} style={{ flexShrink: 0, marginTop: 1 }} />
              <div>
                <div style={{ fontSize: 11.5, fontWeight: 800, color: "#C0454B", letterSpacing: ".2px" }}>REJECTED</div>
                {item.rejectReason && <div style={{ fontSize: 12.5, color: "#9A5A5E", marginTop: 2, lineHeight: 1.45 }}>{item.rejectReason}</div>}
              </div>
            </div>
          )}

          {duplicate && (
            <div style={{ marginTop: 12, padding: "12px 14px", background: "#FBF1E0", border: "1px solid #ECD49C", borderRadius: 10 }}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 9 }}>
                <IconWarn s={16} stroke="#A86A12" sw={1.8} style={{ flexShrink: 0, marginTop: 1 }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 11.5, fontWeight: 800, color: "#A86A12", letterSpacing: ".2px" }}>TOO SIMILAR — WON&apos;T BE KEPT</div>
                  {item.dupNote && <div style={{ fontSize: 12.5, color: "#8A6A2E", marginTop: 2, lineHeight: 1.45 }}>{item.dupNote}</div>}
                </div>
              </div>
              {item.dupMatches.length > 0 && (
                <div style={{ marginTop: 11, paddingTop: 11, borderTop: "1px solid #EAD49C" }}>
                  <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: ".4px", color: "#A86A12", marginBottom: 7 }}>SIMILAR TO</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {item.dupMatches.map((m, k) => (
                      <div key={k} style={{ display: "flex", alignItems: "flex-start", gap: 8, background: "#fff", border: "1px solid #EBD9AE", borderRadius: 8, padding: "8px 10px" }}>
                        <span style={{ fontSize: 10.5, fontWeight: 800, color: "#A86A12", background: "#FBF1E0", borderRadius: 5, padding: "2px 6px", flexShrink: 0, whiteSpace: "nowrap" }}>{m.label}</span>
                        <span style={{ fontSize: 12.5, color: "#7A5E2A", lineHeight: 1.4 }}>{m.text}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* action row */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 14, paddingTop: 13, borderTop: "1px solid #F0F3F6" }}>
            <button onClick={p.onApprove} style={{ height: 35, padding: "0 14px", borderRadius: 9, fontSize: 12.5, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 7, color: approved ? "#fff" : "#2E7D32", background: approved ? "#2E7D32" : "#EAF6E4", border: `1.5px solid ${approved ? "#2E7D32" : "#BFE0AC"}` }}>
              <IconCheck s={14} sw={2.2} />
              {approved ? "Approved" : "Approve"}
            </button>
            {!demoted && (
              <>
                <HBtn onClick={p.onEdit} style={{ height: 35, padding: "0 13px", borderRadius: 9, fontSize: 12.5, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 7, color: C.slate, background: "#fff", border: "1.5px solid #E3E8ED" }} hover={{ borderColor: "#C8D2DC", background: "#FAFBFC" }}>
                  <IconPencil s={14} sw={1.7} />
                  Edit
                </HBtn>
                <HBtn onClick={p.onAiEdit} style={{ height: 35, padding: "0 13px", borderRadius: 9, fontSize: 12.5, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 7, color: C.navy, background: "#E1E8F4", border: "1.5px solid #CFDBEC" }} hover={{ background: "#D4E0F0" }}>
                  <IconSpark s={14} sw={1.7} />
                  Edit with AI
                </HBtn>
                <div style={{ flex: 1 }} />
                <HBtn onClick={p.onDuplicate} style={{ height: 35, padding: "0 13px", borderRadius: 9, fontSize: 12.5, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 7, color: "#A86A12", background: "#fff", border: "1.5px solid #ECD49C" }} hover={{ background: "#FBF1E0" }}>
                  <svg width="14" height="14" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth={1.7}>
                    <rect x="3" y="3" width="9" height="9" rx="1.6" />
                    <path d="M6 12.5v1.5a1.5 1.5 0 001.5 1.5H14a1.5 1.5 0 001.5-1.5V8a1.5 1.5 0 00-1.5-1.5h-1.5" />
                  </svg>
                  Too similar
                </HBtn>
                <HBtn onClick={p.onReject} style={{ height: 35, padding: "0 13px", borderRadius: 9, fontSize: 12.5, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 7, color: "#C0454B", background: "#fff", border: "1.5px solid #F0C9CC" }} hover={{ background: "#FCEBEC" }}>
                  <IconX s={14} sw={2} />
                  Reject
                </HBtn>
              </>
            )}
            {rejected && (
              <>
                <div style={{ flex: 1 }} />
                <span style={{ fontSize: 12, color: C.faint }}>Approve to restore</span>
              </>
            )}
            {duplicate && (
              <>
                <div style={{ flex: 1 }} />
                <span style={{ fontSize: 12, color: C.faint }}>Approve to keep instead</span>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
