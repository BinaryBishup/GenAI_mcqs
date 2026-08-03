"use client";

// Create from scratch — a step-wizard modal (design: "Create From Scratch v2").
// Flow: Describe (one open question) → Follow-up (ONE page with ALL follow-up
// questions the model still needs, asked as cards) → Brief → Samples → generate.
// The follow-up batch is generated from the description + documents, so it
// adapts to what the author wrote; a second batch only appears when an answer
// was genuinely unclear. Every page is revisitable (Back / stepper / recap
// chips) because the transcript is rebuilt from the page history each turn.

import { useCallback, useEffect, useRef, useState } from "react";
import { C, diffStyle, titleCase } from "../theme";
import { HBox, HBtn, HTextarea, Spinner } from "../ui";
import { IconCheck, IconFile, IconImage, IconLoop, IconPencil, IconSpark, IconUpload, IconX } from "../icons";
import { useSmartCoGen } from "../store";
import { ingestScratchDoc, scratchInterview, scratchSamples } from "@/lib/api";
import type { GenerateRequest, ScratchBrief, ScratchChatMsg, ScratchDoc, ScratchVariant } from "@/lib/types";

/** The fixed opening step — a plain open question, no suggestions. */
const OPENING_Q =
  "What would you like to create? Describe the question set in your own words — the topic, who it's for, and anything else that matters.";

type PageQ = { question: string; options: string[]; multi: boolean; answer: string | null };
type Step = { kind: "page"; qs: PageQ[]; fixed?: boolean } | { kind: "doc"; name: string };
type Phase = "interview" | "audience" | "brief" | "samples";

/** Fixed choices for the structured Audience step (design: "Who is this for?"). */
const AUD_TIERS = ["Tier 1", "Tier 2", "Tier 3", "Tier 4"];
const AUD_EXPS = ["0\u20132 years", "2\u20135 years", "5\u20138 years", "8+ years"];
const AUD_DIFFS = ["Easy", "Medium", "Hard"];
const AUD_COUNTS = ["10", "15", "20", "25"];

const openingPage = (): Step => ({ kind: "page", qs: [{ question: OPENING_Q, options: [], multi: false, answer: null }] });

/** Palette from the "Create From Scratch v2" design. */
const D = {
  navy: "#16233F",
  ink: "#1B2A4A",
  border: "#E4E7EE",
  border2: "#D8DDE8",
  page: "#EEF0F4",
  green: "#2E7D4F",
  muted: "#6B7488",
  faint: "#9AA2B5",
  slate: "#4A5570",
};

const STAGE_LABELS = ["Describe", "Audience", "Follow-up", "Brief", "Samples"];

// ---- Small stroke icons local to the wizard (style matches ../icons.tsx) ----
function IconGrad({ s = 16, stroke = "currentColor" }: { s?: number; stroke?: string }) {
  return (
    <svg width={s} height={s} viewBox="0 0 18 18" fill="none" stroke={stroke} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      <path d="M1.8 6.6 9 3.2l7.2 3.4L9 10 1.8 6.6z" />
      <path d="M4.6 8.4v3.2c0 1.1 2 2.1 4.4 2.1s4.4-1 4.4-2.1V8.4" />
      <path d="M16.2 7v4" />
    </svg>
  );
}
function IconBriefcase({ s = 16, stroke = "currentColor" }: { s?: number; stroke?: string }) {
  return (
    <svg width={s} height={s} viewBox="0 0 18 18" fill="none" stroke={stroke} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      <rect x="2.2" y="5.4" width="13.6" height="9.4" rx="1.6" />
      <path d="M6.4 5.4V4.2A1.7 1.7 0 018.1 2.5h1.8a1.7 1.7 0 011.7 1.7v1.2" />
      <path d="M2.2 9.3h13.6" />
    </svg>
  );
}
function IconGauge({ s = 16, stroke = "currentColor" }: { s?: number; stroke?: string }) {
  return (
    <svg width={s} height={s} viewBox="0 0 18 18" fill="none" stroke={stroke} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      <path d="M3.2 13.5a6.5 6.5 0 1111.6 0" />
      <path d="M9 11.5l2.8-3.3" />
    </svg>
  );
}
function IconHash({ s = 16, stroke = "currentColor" }: { s?: number; stroke?: string }) {
  return (
    <svg width={s} height={s} viewBox="0 0 18 18" fill="none" stroke={stroke} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      <path d="M6.8 2.8 5.4 15.2M12.6 2.8l-1.4 12.4M3 6.6h12.4M2.6 11.4H15" />
    </svg>
  );
}
/** Difficulty level bars: 1 = easy … 3 = hard. Inactive bars are faded. */
function IconBars({ level, s = 15 }: { level: 1 | 2 | 3; s?: number }) {
  return (
    <svg width={s} height={s} viewBox="0 0 18 18" fill="currentColor" stroke="none">
      <rect x="2.5" y="11" width="3.4" height="4.5" rx="1" opacity={level >= 1 ? 1 : 0.25} />
      <rect x="7.3" y="7.5" width="3.4" height="8" rx="1" opacity={level >= 2 ? 1 : 0.25} />
      <rect x="12.1" y="4" width="3.4" height="11.5" rx="1" opacity={level >= 3 ? 1 : 0.25} />
    </svg>
  );
}


/** Rebuild the interview transcript from the wizard's page history. */
function toTranscript(steps: Step[]): ScratchChatMsg[] {
  return steps.flatMap((s): ScratchChatMsg[] => {
    if (s.kind === "doc") {
      return [{ role: "user", text: `(Attached reference document: ${s.name} — its extracted content is in <reference_documents>.)` }];
    }
    return s.qs.flatMap((q): ScratchChatMsg[] => {
      const msgs: ScratchChatMsg[] = [{ role: "assistant", text: q.question }];
      if (q.answer) msgs.push({ role: "user", text: q.answer });
      return msgs;
    });
  });
}

const EXEMPLAR_NOTE =
  "APPROVED EXEMPLARS — the test author reviewed sample questions and approved the ones listed under 'Additional sample notes'. Spread the generated set across those approved styles, matching their framing, depth, candidate skill, and option format. Do NOT reuse their exact scenarios, entities, numbers, or wording.";

function exemplarBlock(sel: ScratchVariant[]): string {
  return sel
    .map((v, i) => {
      const lines = [`Exemplar ${i + 1} — ${v.style_label}${v.style_summary ? `: ${v.style_summary}` : ""}`, `Q: ${v.mcq.question}`];
      if (v.mcq.snippet?.code) lines.push("```" + v.mcq.snippet.language, v.mcq.snippet.code, "```");
      v.mcq.options.forEach((o, j) => lines.push(`  ${"ABCD"[j]}) ${o}${j === v.mcq.correct_index ? "   [correct]" : ""}`));
      return lines.join("\n");
    })
    .join("\n\n");
}

export function Scratch() {
  const { startRun, toast, go, screen, scratchOpen, setScratchOpen } = useSmartCoGen();
  const open = scratchOpen || screen === "scratch";
  const [steps, setSteps] = useState<Step[]>([]);
  const [docs, setDocs] = useState<ScratchDoc[]>([]);
  const [phase, setPhase] = useState<Phase>("interview");
  const [brief, setBrief] = useState<ScratchBrief | null>(null);
  const [briefSummary, setBriefSummary] = useState("");
  const [variants, setVariants] = useState<ScratchVariant[] | null>(null);
  const [seenSampleQs, setSeenSampleQs] = useState<string[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  // Draft answers for the current page, keyed by question index.
  const [picked, setPicked] = useState<Record<number, string[]>>({});
  const [text, setText] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const [busyLabel, setBusyLabel] = useState("Thinking…");
  const [launching, setLaunching] = useState(false);
  // Structured Audience step (step 2) — collected by the app's form, not the LLM.
  const [audMode, setAudMode] = useState<"Campus" | "Lateral hiring">("Campus");
  const [audTier, setAudTier] = useState<string | null>(null);
  const [audExp, setAudExp] = useState<string | null>(null);
  const [audDiff, setAudDiff] = useState<string | null>(null);
  const [audCount, setAudCount] = useState<string | null>(null);
  const [audCustomCount, setAudCustomCount] = useState("");

  const fileInput = useRef<HTMLInputElement>(null);
  const started = useRef(false);
  const stepsRef = useRef<Step[]>([]);
  stepsRef.current = steps;
  const docsRef = useRef<ScratchDoc[]>([]);
  docsRef.current = docs;

  const pages = steps.filter((s): s is Extract<Step, { kind: "page" }> => s.kind === "page");
  const pageDone = (p: Extract<Step, { kind: "page" }>) => p.qs.every((q) => q.answer !== null);
  const currentPage = pages.find((p) => !pageDone(p)) ?? null;
  const answeredPages = pages.filter(pageDone);
  const isOpening = currentPage !== null && pages.indexOf(currentPage) === 0;

  const clearDraft = () => { setPicked({}); setText({}); };

  /** One interview turn against the given step history (plus optional extra transcript lines). */
  const runTurn = useCallback(async (base: Step[], extraMsgs: ScratchChatMsg[] = []) => {
    setBusy(true);
    setBusyLabel("Thinking…");
    clearDraft();
    try {
      const reply = await scratchInterview([...toTranscript(base), ...extraMsgs], docsRef.current);
      if (reply.action === "ready") {
        setSteps(base);
        setBrief(reply.brief);
        setBriefSummary(reply.summary);
        setPhase("brief");
      } else {
        setSteps([
          ...base,
          { kind: "page", qs: reply.questions.map((q) => ({ question: q.question, options: q.quick_replies ?? [], multi: q.multi === true, answer: null })) },
        ]);
        setPhase("interview");
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : "Something went wrong — please try again");
      setSteps(base);
    } finally {
      setBusy(false);
    }
  }, [toast]);

  // First open: show the fixed opening question (no model call — instant) and
  // fetch the team's saved reference documents for reuse.
  useEffect(() => {
    if (!open || started.current) return;
    started.current = true;
    setSteps([openingPage()]);
  }, [open]);

  const close = useCallback(() => {
    setScratchOpen(false);
    if (screen === "scratch") go("dashboard");
  }, [setScratchOpen, screen, go]);

  /** Resolve the draft answer for question i of the current page ("" = unanswered). */
  const draftAnswer = useCallback((q: PageQ, i: number): string => {
    const typed = (text[i] ?? "").trim();
    const chosen = picked[i] ?? [];
    if (q.multi) return [...chosen, typed].filter(Boolean).join(", ");
    return typed || chosen[0] || "";
  }, [picked, text]);

  const pageComplete = currentPage !== null && currentPage.qs.every((q, i) => draftAnswer(q, i).length > 0);

  /** Submit every answer on the current page. The opening (Describe) page leads
   *  into the structured Audience step; later pages go back to the model. */
  const submitPage = useCallback(() => {
    if (!currentPage || busy || !pageComplete) return;
    const opening = pages.indexOf(currentPage) === 0;
    const answers = currentPage.qs.map((q, i) => draftAnswer(q, i));
    const base = stepsRef.current.map((s) =>
      s === currentPage ? { ...s, kind: "page" as const, qs: (s as Extract<Step, { kind: "page" }>).qs.map((q, i) => ({ ...q, answer: answers[i] })) } : s,
    );
    if (opening) {
      setSteps(base as Step[]);
      clearDraft();
      setPhase("audience");
      return;
    }
    runTurn(base as Step[]);
  }, [currentPage, busy, pageComplete, pages, draftAnswer, runTurn]);

  /** Confirm the Audience step: record its answers as a fixed page, then fetch the follow-up batch. */
  const submitAudience = useCallback(() => {
    if (busy) return;
    const who = audMode === "Campus"
      ? `Campus hiring \u2014 ${audTier} colleges`
      : `Lateral hiring \u2014 candidates with ${audExp} of experience`;
    const countVal = audCustomCount.trim() || audCount || "";
    const page: Step = {
      kind: "page",
      fixed: true,
      qs: [
        { question: "Who is this for?", options: [], multi: false, answer: who },
        { question: "What difficulty and how many questions?", options: [], multi: false, answer: `${audDiff} difficulty, ${countVal} questions` },
      ],
    };
    runTurn([...stepsRef.current, page]);
  }, [busy, audMode, audTier, audExp, audDiff, audCount, audCustomCount, runTurn]);

  /** Jump back: re-open answered page `pageIdx` (drops everything after it).
   *  The fixed Audience page reopens as the structured form (its selections
   *  are still in component state). */
  const backToPage = useCallback((pageIdx: number) => {
    if (busy) return;
    let seen = -1;
    let reopenAudience = false;
    const cut: Step[] = [];
    for (const s of stepsRef.current) {
      if (s.kind === "page") {
        seen++;
        if (seen === pageIdx) {
          if (s.fixed) reopenAudience = true;
          else cut.push({ kind: "page", qs: s.qs.map((q) => ({ ...q, answer: null })) });
          break;
        }
      }
      cut.push(s);
    }
    setSteps(cut);
    setPhase(reopenAudience ? "audience" : "interview");
    setBrief(null);
    setBriefSummary("");
    setVariants(null);
    setSelected(new Set());
    clearDraft();
  }, [busy]);

  const back = useCallback(() => {
    if (phase === "samples") { setPhase("brief"); return; }
    if (phase === "audience") { backToPage(0); return; }
    if (answeredPages.length > 0) backToPage(answeredPages.length - 1);
  }, [phase, answeredPages.length, backToPage]);

  /** Add a (freshly-ingested or saved) document and re-plan the follow-ups —
   *  the interview may now skip questions the document already answers. On the
   *  opening page the document alone isn't enough (we still need the author's
   *  description), so we just keep the page open with the doc noted. */
  const addDoc = useCallback(async (doc: ScratchDoc) => {
    setDocs((prev) => [...prev, doc]);
    docsRef.current = [...docsRef.current, doc];
    const onOpening = stepsRef.current.filter((s) => s.kind === "page").length === 1 && currentPage !== null && pages.indexOf(currentPage) === 0;
    if (onOpening) {
      setSteps([{ kind: "doc", name: doc.name }, ...stepsRef.current]);
      setBusy(false);
      return;
    }
    const base = stepsRef.current.filter((s) => !(s.kind === "page" && !pageDone(s)));
    await runTurn([...base, { kind: "doc", name: doc.name }]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runTurn, currentPage]);

  const attach = useCallback(async (list: FileList | null) => {
    const f = list?.[0];
    if (!f || busy) return;
    if (!/\.(pdf|docx?|xlsx?|csv|txt|md)$/i.test(f.name)) { toast(`${f.name}: only PDF, Word, Excel, CSV, TXT or MD files`); return; }
    if (f.size > 20 * 1024 * 1024) { toast(`${f.name}: too large (max 20 MB)`); return; }
    if (docsRef.current.length >= 4) { toast("Up to 4 documents per set"); return; }
    setBusy(true);
    setBusyLabel(`Reading ${f.name}…`);
    try {
      const doc = await ingestScratchDoc(f);
      await addDoc(doc);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not read the file");
      setBusy(false);
    }
  }, [busy, addDoc, toast]);

  /** Brief-phase adjustment ("make it 20 questions", "add Helm"). */
  const adjustBrief = useCallback((t: string) => {
    const v = t.trim();
    if (!v || busy) return;
    runTurn(stepsRef.current, [
      { role: "assistant", text: `(Brief is ready) ${briefSummary}` },
      { role: "user", text: v },
    ]);
  }, [busy, briefSummary, runTurn]);

  const showSamples = useCallback(async (exclude?: string[]) => {
    if (!brief || busy) return;
    setBusy(true);
    setBusyLabel("Writing sample questions…");
    try {
      const v = await scratchSamples(brief, exclude);
      setSelected(new Set());
      setVariants(v);
      setSeenSampleQs((prev) => [...prev, ...v.map((x) => x.mcq.question)]);
      setPhase("samples");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Sample generation failed");
    } finally {
      setBusy(false);
    }
  }, [brief, busy, toast]);

  const launch = useCallback(() => {
    if (!brief || !variants || launching) return;
    const sel = variants.filter((_, i) => selected.has(i));
    if (sel.length === 0) { toast("Select at least one sample you like"); return; }
    setLaunching(true);
    const kinds = [...new Set(sel.map((v) => v.kind))];
    const req: GenerateRequest = {
      count: brief.count,
      topic: brief.topic,
      difficulty: brief.difficulty,
      mcq_type: brief.mcq_type,
      languages: brief.languages,
      samples: [],
      samples_raw: exemplarBlock(sel),
      sample_files: [],
      samples_per_file: 4,
      max_revamp_attempts: 3,
      quality: "balanced",
      extra_prompt: [brief.content_guidance, EXEMPLAR_NOTE].join("\n\n"),
      negative_prompt: brief.negative_prompt,
      grounding: true,
      create_images: brief.create_images,
      mode: "scratch",
      question_kinds: kinds.length ? kinds : brief.question_kinds,
      attachments: docsRef.current,
    };
    startRun(req);
    toast(`${brief.count} questions queued — building in your chosen style${sel.length > 1 ? "s" : ""}`);
  }, [brief, variants, launching, selected, startRun, toast]);

  const reset = useCallback(() => {
    setSteps([openingPage()]);
    setDocs([]);
    setBrief(null);
    setBriefSummary("");
    setVariants(null);
    setSeenSampleQs([]);
    setSelected(new Set());
    clearDraft();
    stepsRef.current = [openingPage()];
    docsRef.current = [];
    setPhase("interview");
    setLaunching(false);
  }, []);

  const canBack = !busy && (phase !== "interview" || answeredPages.length > 0);

  // Stepper stages: Describe -> Audience -> Follow-up -> Brief -> Samples
  const stageIdx = phase === "samples" ? 4 : phase === "brief" ? 3 : phase === "audience" ? 1 : isOpening ? 0 : 2;
  const jumpToStage = (i: number) => {
    if (busy || i >= stageIdx) return;
    if (i === 0) backToPage(0);
    else if (i === 1) backToPage(pages.findIndex((p) => p.fixed));
    else if (i === 2) backToPage(answeredPages.length - 1);
    else if (i === 3) setPhase("brief");
  };

  // Footer CTA — label + behaviour depend on the phase.
  let ctaLabel = "Continue →";
  let ctaEnabled = false;
  let onCta: () => void = () => {};
  if (phase === "interview") {
    ctaEnabled = !busy && pageComplete;
    onCta = submitPage;
  } else if (phase === "audience") {
    const audReady = (audMode === "Campus" ? !!audTier : !!audExp) && !!audDiff && (!!audCount || !!audCustomCount.trim());
    ctaEnabled = !busy && audReady;
    onCta = submitAudience;
  } else if (phase === "brief") {
    ctaLabel = "Show samples →";
    ctaEnabled = !busy;
    onCta = () => showSamples();
  } else {
    ctaLabel = "Generate questions";
    ctaEnabled = !busy && !launching && selected.size > 0;
    onCta = launch;
  }

  if (!open) return null;

  return (
    <div style={{ position: "fixed", inset: 0, background: D.page, zIndex: 80, display: "flex", flexDirection: "column", color: D.ink }}>
      <style>{`@keyframes dcFadeUp{from{opacity:0;transform:translateY(8px);}to{opacity:1;transform:none;}}`}</style>
      <input ref={fileInput} type="file" accept=".pdf,.docx,.doc,.xlsx,.xls,.csv,.txt,.md" style={{ display: "none" }} onChange={(e) => { attach(e.target.files); e.target.value = ""; }} />

      {/* ---- top bar with stepper ---- */}
      <header style={{ height: 68, background: "#fff", borderBottom: `1px solid ${D.border}`, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 28px", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 38, height: 38, borderRadius: 10, background: D.navy, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <IconSpark s={18} stroke="#fff" />
          </div>
          <div style={{ fontSize: 17.5, fontWeight: 700, letterSpacing: "-0.01em" }}>Create from scratch</div>
        </div>
        <div style={{ display: "flex", alignItems: "center" }}>
          {STAGE_LABELS.map((label, i) => {
            const done = i < stageIdx;
            const current = i === stageIdx;
            return (
              <div key={label} style={{ display: "flex", alignItems: "center" }}>
                <HBox
                  onClick={() => jumpToStage(i)}
                  style={{ display: "flex", alignItems: "center", gap: 8, cursor: done ? "pointer" : "default", padding: "6px 10px", borderRadius: 8 }}
                  hover={done ? { background: "#F3F5F9" } : undefined}
                >
                  <div style={{ width: 27, height: 27, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, background: done ? D.green : current ? D.navy : "#fff", color: done || current ? "#fff" : D.faint, border: `1.5px solid ${done ? D.green : current ? D.navy : D.border2}` }}>
                    {done ? "✓" : i + 1}
                  </div>
                  <span style={{ fontSize: 15, fontWeight: 600, color: current ? D.ink : done ? D.green : D.faint }}>{label}</span>
                </HBox>
                {i < STAGE_LABELS.length - 1 && <div style={{ width: 32, height: 2.5, borderRadius: 2, background: done ? D.green : D.border, margin: "0 4px" }} />}
              </div>
            );
          })}
        </div>
        <HBox onClick={close} title="Close" style={{ width: 38, height: 38, borderRadius: 10, border: `1.5px solid ${D.border}`, background: "#fff", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }} hover={{ background: "#F3F5F9" }}>
          <IconX s={16} stroke={D.muted} />
        </HBox>
      </header>

      {/* ---- body ---- */}
      <div style={{ flex: 1, overflowY: "auto", display: "flex", justifyContent: "center", padding: "36px 28px 120px" }}>
        <main style={{ width: "100%", maxWidth: phase === "samples" ? 1240 : 980 }}>
          {busy ? (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14, minHeight: 260 }}>
              <Spinner size={22} />
              <span style={{ fontSize: 15.5, color: D.muted, fontWeight: 600 }}>{busyLabel}</span>
            </div>
          ) : phase === "interview" && currentPage && isOpening ? (
            /* ---- DESCRIBE ---- */
            <div style={{ animation: "dcFadeUp .3s ease both" }}>
              <h1 style={{ fontSize: 36, fontWeight: 700, letterSpacing: "-0.02em", margin: "0 0 28px", textAlign: "center" }}>What questions do you want to create?</h1>
              <div style={{ background: "#fff", border: `1.5px solid ${D.border2}`, borderRadius: 16, padding: "24px 24px 16px", boxShadow: "0 1px 2px rgba(22,35,63,0.04)" }}>
                <HTextarea
                  value={text[0] ?? ""}
                  onChange={(e) => setText((t) => ({ ...t, 0: e.target.value }))}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submitPage(); } }}
                  placeholder="e.g. Questions on conditional probability and Bayes' theorem for junior data analysts…"
                  rows={3}
                  style={{ width: "100%", border: "none", resize: "vertical", fontFamily: "inherit", fontSize: 19, lineHeight: 1.55, color: D.ink, minHeight: 110, background: "transparent", outline: "none" }}
                />
                <div style={{ display: "flex", alignItems: "center", gap: 8, borderTop: "1px solid #EEF0F4", paddingTop: 10, marginTop: 6, flexWrap: "wrap" }}>
                  <HBox
                    onClick={() => fileInput.current?.click()}
                    style={{ display: "inline-flex", alignItems: "center", gap: 8, border: "1.5px dashed #C6CCDA", background: "#FAFBFD", borderRadius: 10, padding: "11px 18px", fontSize: 15, color: D.slate, cursor: "pointer", fontWeight: 600 }}
                    hover={{ borderColor: D.navy, color: D.navy }}
                  >
                    <IconUpload s={14} stroke={D.slate} /> Attach syllabus or notes
                  </HBox>
                  {docs.map((d) => (
                    <span key={d.name} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 700, color: D.navy, background: "#F0F3FA", border: `1px solid ${D.border2}`, borderRadius: 100, padding: "5px 12px" }}>
                      <IconFile s={12} stroke={D.navy} /> {d.name}
                      <IconCheck s={11} sw={2.4} stroke={D.green} />
                    </span>
                  ))}
                </div>
              </div>
            </div>
          ) : phase === "audience" ? (
            /* ---- AUDIENCE: structured form (design: "Who is this for?") ---- */
            <div style={{ animation: "dcFadeUp .3s ease both" }}>
              <h1 style={{ fontSize: 36, fontWeight: 700, letterSpacing: "-0.02em", margin: "0 0 28px", textAlign: "center" }}>Who is this for?</h1>

              {/* segmented: Campus | Lateral hiring */}
              <div style={{ display: "flex", background: "#F3F5F9", border: `1px solid ${D.border}`, borderRadius: 12, padding: 4, gap: 4, marginBottom: 20 }}>
                {(["Campus", "Lateral hiring"] as const).map((m) => {
                  const on = audMode === m;
                  return (
                    <HBox
                      key={m}
                      onClick={() => setAudMode(m)}
                      style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 9, borderRadius: 10, padding: "15px 0", fontSize: 16, fontWeight: 700, cursor: "pointer", background: on ? "#fff" : "transparent", color: on ? D.navy : D.muted, boxShadow: on ? "0 1px 3px rgba(22,35,63,0.14)" : "none" }}
                    >
                      {m === "Campus" ? <IconGrad s={17} /> : <IconBriefcase s={16} />}
                      {m}
                    </HBox>
                  );
                })}
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <section style={{ background: "#fff", border: `1.5px solid ${D.border}`, borderRadius: 16, padding: 26 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
                    <span style={{ width: 28, height: 28, borderRadius: 8, background: "#F0F3FA", color: D.navy, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{audMode === "Campus" ? <IconGrad s={16} /> : <IconBriefcase s={15} />}</span>
                    <span style={{ fontSize: 16.5, fontWeight: 700 }}>{audMode === "Campus" ? "Campus category" : "Years of experience"}</span>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                    {(audMode === "Campus" ? AUD_TIERS : AUD_EXPS).map((t) => (
                      <RadioRow
                        key={t}
                        label={t}
                        on={(audMode === "Campus" ? audTier : audExp) === t}
                        onClick={() => (audMode === "Campus" ? setAudTier(t) : setAudExp(t))}
                      />
                    ))}
                  </div>
                </section>

                <section style={{ background: "#fff", border: `1.5px solid ${D.border}`, borderRadius: 16, padding: 26 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
                    <span style={{ width: 28, height: 28, borderRadius: 8, background: "#F0F3FA", color: D.navy, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><IconGauge s={16} /></span>
                    <span style={{ fontSize: 16.5, fontWeight: 700 }}>Difficulty</span>
                  </div>
                  <div style={{ display: "flex", background: "#F3F5F9", border: `1px solid ${D.border}`, borderRadius: 12, padding: 4, gap: 4 }}>
                    {AUD_DIFFS.map((t, i) => {
                      const on = audDiff === t;
                      return (
                        <HBox
                          key={t}
                          onClick={() => setAudDiff(t)}
                          style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 10, padding: "15px 0", fontSize: 16, fontWeight: 700, cursor: "pointer", background: on ? "#fff" : "transparent", color: on ? D.navy : D.muted, boxShadow: on ? "0 1px 3px rgba(22,35,63,0.14)" : "none" }}
                        >
                          <IconBars level={(i + 1) as 1 | 2 | 3} />
                          {t}
                        </HBox>
                      );
                    })}
                  </div>
                </section>

                <section style={{ background: "#fff", border: `1.5px solid ${D.border}`, borderRadius: 16, padding: 26 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
                    <span style={{ width: 28, height: 28, borderRadius: 8, background: "#F0F3FA", color: D.navy, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><IconHash s={15} /></span>
                    <span style={{ fontSize: 16.5, fontWeight: 700 }}>Number of questions</span>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                    {AUD_COUNTS.map((t) => (
                      <RadioRow key={t} label={`${t} questions`} on={audCount === t && !audCustomCount.trim()} onClick={() => { setAudCount(t); setAudCustomCount(""); }} />
                    ))}
                  </div>
                  <input
                    value={audCustomCount}
                    onChange={(e) => setAudCustomCount(e.target.value.replace(/[^0-9]/g, ""))}
                    placeholder="Or a custom number (5–50)…"
                    style={{ width: "100%", marginTop: 10, border: `1.5px dashed ${D.border2}`, borderRadius: 10, padding: "15px 18px", fontSize: 15.5, color: D.ink, fontFamily: "inherit", background: "#FAFBFD", boxSizing: "border-box" }}
                  />
                </section>
              </div>
            </div>
          ) : phase === "interview" && currentPage ? (
            /* ---- FOLLOW-UP: all remaining questions on one page ---- */
            <div style={{ animation: "dcFadeUp .3s ease both" }}>
              {(answeredPages.length > 0 || docs.length > 0) && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 20, justifyContent: "center" }}>
                  {answeredPages.flatMap((p, pi) =>
                    p.qs.map((q, qi) => (
                      <HBox
                        key={`${pi}-${qi}`}
                        onClick={() => backToPage(pi)}
                        title={`${q.question} — click to change`}
                        style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13.5, fontWeight: 600, color: D.slate, background: "#fff", border: `1.5px solid ${D.border}`, borderRadius: 100, padding: "8px 15px", cursor: "pointer", maxWidth: 300, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
                        hover={{ borderColor: D.navy, color: D.navy }}
                      >
                        <IconCheck s={11} sw={2.6} stroke={D.green} />
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{q.answer}</span>
                      </HBox>
                    )),
                  )}
                  {docs.map((d) => (
                    <span key={d.name} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, fontWeight: 600, color: D.navy, background: "#F0F3FA", borderRadius: 100, padding: "5px 12px" }}>
                      <IconFile s={12} stroke={D.navy} /> {d.name}
                    </span>
                  ))}
                </div>
              )}
              <h1 style={{ fontSize: 36, fontWeight: 700, letterSpacing: "-0.02em", margin: "0 0 28px", textAlign: "center" }}>
                {currentPage.qs.length > 1 ? "A couple of quick follow-ups" : "One more question"}
              </h1>
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                {currentPage.qs.map((q, i) => {
                  const chosen = picked[i] ?? [];
                  return (
                    <section key={i} style={{ background: "#fff", border: `1.5px solid ${D.border}`, borderRadius: 16, padding: 26 }}>
                      <div style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 14 }}>
                        <span style={{ width: 34, height: 34, borderRadius: 10, background: "#F0F3FA", color: D.navy, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                          <IconSpark s={16} stroke={D.navy} />
                        </span>
                        <div style={{ fontSize: 18, fontWeight: 700, lineHeight: 1.45 }}>
                          {q.question}
                          {q.multi && <span style={{ fontSize: 11, fontWeight: 700, color: D.faint, marginLeft: 8, letterSpacing: "0.05em" }}>PICK ONE OR MORE</span>}
                        </div>
                      </div>
                      {q.options.length > 0 && (
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
                          {q.options.map((o) => {
                            const on = chosen.includes(o);
                            return (
                              <HBox
                                key={o}
                                onClick={() => {
                                  setPicked((prev) => {
                                    const cur = prev[i] ?? [];
                                    if (q.multi) return { ...prev, [i]: on ? cur.filter((x) => x !== o) : [...cur, o] };
                                    return { ...prev, [i]: on ? [] : [o] };
                                  });
                                }}
                                style={{ display: "inline-flex", alignItems: "center", gap: 8, border: `1.5px solid ${on ? D.navy : D.border}`, background: on ? "#F0F3FA" : "#fff", color: on ? D.navy : D.slate, borderRadius: 11, padding: "13px 20px", fontSize: 15.5, fontWeight: 600, cursor: "pointer" }}
                                hover={{ borderColor: D.navy, color: D.navy }}
                              >
                                {on && <IconCheck s={11} sw={2.8} stroke={D.navy} />}
                                {o}
                              </HBox>
                            );
                          })}
                        </div>
                      )}
                      <input
                        value={text[i] ?? ""}
                        onChange={(e) => setText((t) => ({ ...t, [i]: e.target.value }))}
                        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); submitPage(); } }}
                        placeholder={q.options.length > 0 ? "Or type your own…" : "Type your answer…"}
                        style={{ width: "100%", border: `1.5px dashed ${D.border2}`, borderRadius: 10, padding: "13px 16px", fontSize: 15, color: D.ink, fontFamily: "inherit", background: "#FAFBFD", boxSizing: "border-box" }}
                      />
                    </section>
                  );
                })}
              </div>
            </div>
          ) : phase === "brief" && brief ? (
            /* ---- BRIEF ---- */
            <div style={{ animation: "dcFadeUp .3s ease both" }}>
              <h1 style={{ fontSize: 36, fontWeight: 700, letterSpacing: "-0.02em", margin: "0 0 28px", textAlign: "center" }}>Here&apos;s your brief</h1>
              <BriefCard brief={brief} summary={briefSummary} />
              <div style={{ marginTop: 20 }}>
                <div style={{ fontSize: 12.5, fontWeight: 700, letterSpacing: "0.08em", color: D.faint, textTransform: "uppercase", marginBottom: 10 }}>Want to change something?</div>
                <AdjustBox onSubmit={adjustBrief} />
              </div>
            </div>
          ) : phase === "samples" && variants ? (
            /* ---- SAMPLES ---- */
            <div style={{ animation: "dcFadeUp .3s ease both" }}>
              <h1 style={{ fontSize: 36, fontWeight: 700, letterSpacing: "-0.02em", margin: "0 0 10px", textAlign: "center" }}>Pick the styles you like</h1>
              <div style={{ fontSize: 16.5, color: D.muted, margin: "0 0 28px", textAlign: "center" }}>
                The full set of <b style={{ color: D.ink }}>{brief?.count}</b> questions will be built in the style(s) you select.
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, alignItems: "start" }}>
                {variants.map((v, i) => (
                  <SampleCard key={i} v={v} on={selected.has(i)} disabled={false} onClick={() => setSelected((prev) => { const n = new Set(prev); if (n.has(i)) { n.delete(i); } else { n.add(i); } return n; })} />
                ))}
              </div>
              <HBox
                onClick={() => showSamples(seenSampleQs)}
                style={{ margin: "20px auto 0", display: "flex", width: "fit-content", alignItems: "center", gap: 8, border: `1.5px solid ${D.border}`, background: "#fff", borderRadius: 11, padding: "13px 22px", fontSize: 15.5, fontWeight: 600, color: D.slate, cursor: "pointer" }}
                hover={{ borderColor: D.navy, color: D.navy }}
              >
                <IconLoop s={14} /> Different varieties
              </HBox>
            </div>
          ) : null}
        </main>
      </div>

      {/* ---- fixed bottom action bar ---- */}
      <footer style={{ position: "absolute", left: 0, right: 0, bottom: 0, background: "rgba(255,255,255,0.92)", backdropFilter: "blur(8px)", borderTop: `1px solid ${D.border}`, padding: "14px 28px", zIndex: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, maxWidth: phase === "samples" ? 1240 : 980, width: "100%", margin: "0 auto", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            {canBack && (
              <HBtn onClick={back} style={{ border: `1.5px solid ${D.border}`, background: "#fff", borderRadius: 11, padding: "15px 26px", fontSize: 16, fontWeight: 600, color: D.slate, cursor: "pointer" }} hover={{ borderColor: D.navy, color: D.navy }}>
                ← Back
              </HBtn>
            )}
            <HBox onClick={reset} style={{ fontSize: 15.5, color: D.faint, cursor: "pointer", fontWeight: 600 }} hover={{ color: D.slate }}>
              Start over
            </HBox>
          </div>
          <HBtn
            onClick={onCta}
            disabled={!ctaEnabled}
            style={{ border: "none", background: ctaEnabled ? D.navy : "#C6CCDA", color: "#fff", borderRadius: 12, padding: "17px 36px", fontSize: 17.5, fontWeight: 700, cursor: ctaEnabled ? "pointer" : "not-allowed", boxShadow: "0 4px 14px rgba(22,35,63,0.22)" }}
            hover={ctaEnabled ? { opacity: 0.92 } : undefined}
          >
            <span style={{ display: "inline-flex", alignItems: "center", gap: 9 }}>
              {phase === "samples" && <IconSpark s={17} stroke="#fff" />}
              {ctaLabel}
            </span>
          </HBtn>
        </div>
      </footer>
    </div>
  );
}

/** Radio row from the v2 design: selected = 2px navy border + light-blue fill + filled dot. */
function RadioRow({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }) {
  return (
    <HBox
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        textAlign: "left",
        border: on ? `2px solid ${D.navy}` : `1.5px solid ${D.border2}`,
        background: on ? "#EFF2FB" : "#fff",
        borderRadius: 12,
        padding: on ? "16.5px 19.5px" : "17px 20px",
        fontSize: 16.5,
        fontWeight: on ? 700 : 600,
        color: on ? D.navy : D.slate,
        cursor: "pointer",
      }}
      hover={on ? undefined : { borderColor: D.navy, color: D.navy }}
    >
      <span style={{ width: 22, height: 22, borderRadius: "50%", border: `2px solid ${on ? D.navy : "#C6CCDA"}`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, boxSizing: "border-box" }}>
        {on && <span style={{ width: 11, height: 11, borderRadius: "50%", background: D.navy }} />}
      </span>
      {label}
    </HBox>
  );
}

/** Brief-adjustment input with its own local state (keeps the page draft records clean). */
function AdjustBox({ onSubmit }: { onSubmit: (t: string) => void }) {
  const [val, setVal] = useState("");
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 9, background: "#fff", border: `1.5px solid ${D.border2}`, borderRadius: 12, padding: "8px 10px" }}>
      <HTextarea
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onSubmit(val); setVal(""); } }}
        placeholder='e.g. "make it 20 questions" or "add Helm and skip RBAC"'
        rows={1}
        style={{ flex: 1, resize: "none", border: "none", outline: "none", fontSize: 13.5, color: D.ink, lineHeight: 1.5, padding: "8px 2px", maxHeight: 88, background: "transparent", fontFamily: "inherit" }}
      />
      <HBtn
        onClick={() => { onSubmit(val); setVal(""); }}
        disabled={!val.trim()}
        style={{ width: 34, height: 34, borderRadius: 9, background: val.trim() ? D.navy : "#E3E8ED", border: "none", display: "flex", alignItems: "center", justifyContent: "center", cursor: val.trim() ? "pointer" : "default", flexShrink: 0 }}
        hover={{ opacity: 0.9 }}
      >
        <IconSpark s={14} stroke="#fff" />
      </HBtn>
    </div>
  );
}

function BriefCard({ brief, summary }: { brief: ScratchBrief; summary: string }) {
  const dd = diffStyle(brief.difficulty);
  const chip = (label: string) => (
    <span style={{ fontSize: 11.5, fontWeight: 700, color: D.slate, background: "#F3F5F9", borderRadius: 100, padding: "4px 11px", whiteSpace: "nowrap" }}>{label}</span>
  );
  return (
    <div style={{ background: "#fff", border: `1.5px solid ${D.border}`, borderRadius: 14, overflow: "hidden" }}>
      <div style={{ padding: "14px 18px", borderBottom: "1px solid #EEF0F4", display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ width: 30, height: 30, borderRadius: 9, background: "#F0F3FA", display: "flex", alignItems: "center", justifyContent: "center" }}><IconPencil s={15} stroke={D.navy} /></div>
        <div>
          <div style={{ fontSize: 17, fontWeight: 800, color: D.ink }}>{brief.topic}</div>
          <div style={{ fontSize: 11.5, color: D.muted }}>Your question set brief</div>
        </div>
      </div>
      <div style={{ padding: "16px 22px", fontSize: 15.5, color: D.ink, lineHeight: 1.6 }}>{summary}</div>
      <div style={{ padding: "0 18px 14px", display: "flex", flexWrap: "wrap", gap: 7 }}>
        <span style={{ fontSize: 11.5, fontWeight: 700, padding: "4px 11px", borderRadius: 100, color: dd.fg, background: dd.bg }}>{titleCase(brief.difficulty)}</span>
        {chip(`${brief.count} questions`)}
        {chip(brief.question_kinds.map(titleCase).join(" + "))}
        {brief.mcq_type === "code" && chip(`Code · ${brief.languages.map(titleCase).join(", ")}`)}
        <span style={{ fontSize: 11.5, fontWeight: 700, color: brief.create_images ? D.navy : D.muted, background: brief.create_images ? "#F0F3FA" : "#F3F5F9", borderRadius: 100, padding: "4px 11px", display: "flex", alignItems: "center", gap: 5 }}>
          <IconImage s={12} /> {brief.create_images ? "With diagrams" : "No diagrams"}
        </span>
      </div>
    </div>
  );
}

function SampleCard({ v, on, disabled, onClick }: { v: ScratchVariant; on: boolean; disabled: boolean; onClick: () => void }) {
  return (
    <HBox
      onClick={onClick}
      style={{
        border: `2px solid ${on ? D.navy : D.border}`,
        background: "#fff",
        borderRadius: 16,
        padding: 24,
        cursor: disabled ? "default" : "pointer",
        boxShadow: on ? "0 6px 18px rgba(22,35,63,0.12)" : "0 1px 2px rgba(22,35,63,0.04)",
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
      hover={disabled ? undefined : { borderColor: D.navy }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: D.slate, background: "#F3F5F9", borderRadius: 100, padding: "5px 13px" }}>{titleCase(v.kind)}</span>
        <span style={{ width: 26, height: 26, borderRadius: 8, border: `1.5px solid ${on ? D.navy : "#C6CCDA"}`, background: on ? D.navy : "#fff", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          {on && <IconCheck s={14} stroke="#fff" sw={2.6} />}
        </span>
      </div>
      <p style={{ fontSize: 16, fontWeight: 600, lineHeight: 1.5, margin: 0, color: D.ink, whiteSpace: "pre-wrap" }}>{v.mcq.question}</p>
      {v.mcq.snippet?.code && (
        <pre style={{ background: C.codeBg, color: C.codeFg, borderRadius: 9, padding: "10px 12px", fontSize: 11.5, lineHeight: 1.5, overflowX: "auto", margin: 0 }}>
          {v.mcq.snippet.code}
        </pre>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        {v.mcq.options.map((o, j) => {
          const correct = j === v.mcq.correct_index;
          return (
            <div key={j} style={{ display: "flex", gap: 8, alignItems: "flex-start", borderRadius: 9, padding: "10px 14px", fontSize: 14, lineHeight: 1.5, background: correct ? "#EFF7F1" : "#FAFBFD", border: `1px solid ${correct ? "#BBDCC6" : "#EEF0F4"}`, color: "#33405E" }}>
              <span style={{ fontWeight: 700, color: correct ? D.green : D.faint }}>{"ABCD"[j]}</span>
              <span style={{ whiteSpace: "pre-wrap" }}>{o}</span>
            </div>
          );
        })}
      </div>
      {v.mcq.explanation && (
        <div style={{ fontSize: 13.5, color: D.muted, lineHeight: 1.5, borderTop: "1px solid #EEF0F4", paddingTop: 11 }}>
          <span style={{ fontWeight: 700, color: D.slate }}>Why: </span>
          {v.mcq.explanation}
        </div>
      )}
    </HBox>
  );
}
