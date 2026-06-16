"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity, Braces, FlaskConical, Gauge, Globe, Loader2, Minus,
  PenLine, Play, Plus, Puzzle, Sparkles, Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Timeline } from "@/components/Timeline";
import { MCQCard } from "@/components/MCQCard";
import { DownloadMenu } from "@/components/DownloadMenu";
import { AppNav } from "@/components/AppNav";
import { QUALITY_RULES, DEFAULT_RULE_IDS } from "@/lib/prompts";
import { startGeneration, fetchFinal } from "@/lib/api";
import { cn } from "@/lib/utils";
import type {
  Difficulty, GenerateRequest, Language, MCQ, MCQType, Quality, QuestionKind, StreamEvent,
} from "@/lib/types";

const DIFFICULTY_OPTIONS: { value: Difficulty; label: string }[] = [
  { value: "easy", label: "Easy" },
  { value: "medium", label: "Medium" },
  { value: "hard", label: "Hard" },
];

const QUALITY_OPTIONS: { value: Quality; label: string; sub: string; Icon: typeof Zap }[] = [
  { value: "fast", label: "Haiku", sub: "Fast", Icon: Zap },
  { value: "balanced", label: "Sonnet", sub: "Balanced", Icon: Gauge },
  { value: "highest", label: "Opus", sub: "Highest", Icon: Sparkles },
];

const KIND_OPTIONS: { value: QuestionKind; label: string; hint: string; Icon: typeof Braces }[] = [
  { value: "application", label: "Application", hint: "use / implement a concept — one direct correct answer", Icon: Puzzle },
  { value: "analysis", label: "Analysis", hint: "reason about behaviour, trade-offs, best practices", Icon: FlaskConical },
];

const CODE_LANGS: Language[] = ["python", "java", "csharp", "cpp", "c", "javascript"];
const CLAUDE_ACCENT = "#d97757";
const QUALITY_BY_DIFFICULTY: Record<Difficulty, Quality> = { easy: "fast", medium: "fast", hard: "balanced" };

export default function GeneratePage() {
  // --- config ---
  const [topic, setTopic] = useState("");
  const [topicError, setTopicError] = useState(false);
  const [count, setCount] = useState(5);
  const [difficulty, setDifficulty] = useState<Difficulty>("medium");
  const [quality, setQuality] = useState<Quality>("fast");
  const [qualityTouched, setQualityTouched] = useState(false);
  const [kinds, setKinds] = useState<Set<QuestionKind>>(() => new Set<QuestionKind>(["application", "analysis"]));
  const [codeBased, setCodeBased] = useState(false);
  const [language, setLanguage] = useState<Language>("python");
  const [grounding, setGrounding] = useState(true);
  const [extraPrompt, setExtraPrompt] = useState("");
  const [negativePrompt, setNegativePrompt] = useState("");
  const [enabledRules, setEnabledRules] = useState<Set<string>>(() => new Set(DEFAULT_RULE_IDS));
  const [rulesOpen, setRulesOpen] = useState(false);

  // --- run state ---
  const [started, setStarted] = useState(false);
  const [events, setEvents] = useState<StreamEvent[]>([]);
  const [results, setResults] = useState<MCQ[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showProcess, setShowProcess] = useState(false);
  const [runId, setRunId] = useState<string | null>(null);
  const cancelRef = useRef<(() => void) | null>(null);

  useEffect(() => () => { cancelRef.current?.(); }, []);

  const mcqType: MCQType = codeBased ? "code" : "general";
  const cleanResults = results.filter(Boolean);
  const phaseMsg = useMemo(() => {
    for (let i = events.length - 1; i >= 0; i--) {
      if (events[i].type === "phase") return events[i].data?.message as string | undefined;
    }
    return undefined;
  }, [events]);

  const applicableRules = useMemo(
    () => QUALITY_RULES.filter((r) => !r.appliesTo || r.appliesTo === mcqType),
    [mcqType],
  );

  function toggleKind(k: QuestionKind) {
    setKinds((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k); else next.add(k);
      // Never allow an empty selection — fall back to "application".
      if (next.size === 0) next.add("application");
      return next;
    });
  }

  function changeDifficulty(d: Difficulty) {
    setDifficulty(d);
    if (!qualityTouched) setQuality(QUALITY_BY_DIFFICULTY[d]);
  }

  function generate() {
    if (!topic.trim()) { setTopicError(true); return; }
    setTopicError(false);
    const req: GenerateRequest = {
      count,
      topic: topic.trim(),
      difficulty,
      mcq_type: mcqType,
      languages: mcqType === "code" ? [language] : [],
      samples: [],
      sample_files: [],
      samples_per_file: 4,
      max_revamp_attempts: 3,
      quality,
      extra_prompt: extraPrompt.trim() || undefined,
      negative_prompt: negativePrompt.trim() || undefined,
      quality_rules: [...enabledRules],
      grounding,
      mode: "scratch",
      question_kinds: [...kinds],
    };

    cancelRef.current?.();
    setStarted(true);
    setEvents([]);
    setResults([]);
    setError(null);
    setRunId(null);
    setRunning(true);

    cancelRef.current = startGeneration(
      req,
      (evt) => {
        setEvents((prev) => [...prev, evt]);
        if ((evt.type === "workflow_start" || evt.type === "workflow_done") && evt.data?.run_id) {
          setRunId(evt.data.run_id as string);
        }
        if (evt.type === "error") {
          setError(evt.data?.message
            ? `${evt.data.phase ? `[${evt.data.phase}] ` : ""}${evt.data.message}`
            : "Generation failed (no message).");
          return;
        }
        if (evt.type === "workflow_done") {
          const qs = evt.data?.questions;
          if (Array.isArray(qs) && qs.length > 0) setResults(qs as MCQ[]);
          else if (evt.data?.run_id) {
            fetchFinal(evt.data.run_id).then((d) => { if (d.questions) setResults(d.questions as MCQ[]); }).catch(() => {});
          }
          return;
        }
        if ((evt.type === "question_start" || evt.type === "question_done") && evt.data?.question) {
          setResults((prev) => {
            const next = [...prev];
            const idx = evt.data.index ?? next.length;
            next[idx] = { ...(next[idx] ?? {}), ...(evt.data.question as Partial<MCQ>) } as MCQ;
            return next;
          });
        }
      },
      () => setRunning(false),
      (e) => { setError(e.message); setRunning(false); },
    );
  }

  function reset() {
    cancelRef.current?.();
    setStarted(false);
    setEvents([]);
    setResults([]);
    setError(null);
    setRunning(false);
    setRunId(null);
  }

  return (
    <div className="flex h-screen flex-col">
      <AppNav />

      {error && (
        <div className="shrink-0 border-b border-destructive/40 bg-destructive/10 px-6 py-3 text-sm text-destructive">
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-widest">Generation failed</p>
          <p className="whitespace-pre-wrap break-words font-mono text-[12px] leading-relaxed">{error}</p>
        </div>
      )}

      {/* body: output (left) + config (right) */}
      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_420px]">
        {/* OUTPUT (left) */}
        <section className="flex min-h-0 flex-col lg:border-r">
          <div className="flex shrink-0 items-center justify-between gap-2 border-b px-6 py-3">
            <div className="flex items-center gap-2">
              <Sparkles className="size-4 text-muted-foreground" />
              <h2 className="text-[11px] font-semibold uppercase tracking-widest">
                {showProcess ? "Process" : "Generated questions"}
              </h2>
              {started && <Badge variant="outline">{cleanResults.length} / {count}</Badge>}
            </div>
            <div className="flex items-center gap-2">
              {started && (
                <Button variant="ghost" size="xs" onClick={() => setShowProcess((v) => !v)}>
                  {showProcess ? <Sparkles /> : <Activity />}
                  {showProcess ? "Questions" : "Process"}
                  {running && !showProcess && <Loader2 className="size-3 animate-spin" />}
                </Button>
              )}
              {started && <DownloadMenu mcqs={cleanResults} topic={topic} />}
            </div>
          </div>

          {showProcess ? (
            <Timeline events={events} running={running} />
          ) : (
            <div className="scrollbar-thin flex-1 min-h-0 overflow-y-auto">
              <div className="mx-auto max-w-[900px] space-y-4 px-6 py-6">
                {!started ? (
                  <div className="py-20 text-center">
                    <div className="mx-auto mb-3 grid size-12 place-items-center rounded-xl bg-muted text-muted-foreground">
                      <PenLine className="size-6" />
                    </div>
                    <p className="text-sm font-medium">Describe a topic on the right, then hit Generate.</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      No sample file needed — questions are generated from the topic and grounded on real sources.
                    </p>
                  </div>
                ) : cleanResults.length === 0 ? (
                  <p className="flex items-center justify-center gap-2 py-20 text-sm text-muted-foreground">
                    <Loader2 className="size-4 animate-spin" />
                    {phaseMsg ?? "Generating… questions will appear here as they finish."}
                  </p>
                ) : (
                  results.map((q, i) =>
                    q ? (
                      <MCQCard
                        key={q.id || i}
                        mcq={q}
                        index={i}
                        runId={runId}
                        onChange={(m) => setResults((prev) => { const n = [...prev]; n[i] = m; return n; })}
                      />
                    ) : null,
                  )
                )}
              </div>
            </div>
          )}
        </section>

        {/* CONFIG (right) */}
        <aside className="flex min-h-0 flex-col border-t lg:border-t-0">
          <div className="scrollbar-thin flex-1 min-h-0 space-y-6 overflow-y-auto px-5 py-6">
            <Field label="Topic">
              <Input
                value={topic}
                onChange={(e) => { setTopic(e.target.value); if (topicError) setTopicError(false); }}
                onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) generate(); }}
                placeholder="e.g. Python generators and iterators"
                className={cn("h-10", topicError && "border-destructive focus-visible:ring-destructive/30")}
                autoFocus
              />
              {topicError && <p className="text-[11px] text-destructive">Enter a topic to generate.</p>}
            </Field>

            <Field label="Question type" hint={`${kinds.size} selected`}>
              <div className="grid gap-1.5">
                {KIND_OPTIONS.map(({ value, label, hint, Icon }) => {
                  const on = kinds.has(value);
                  return (
                    <button
                      key={value}
                      type="button"
                      onClick={() => toggleKind(value)}
                      aria-pressed={on}
                      className={cn(
                        "flex items-start gap-2.5 rounded-md border px-3 py-2 text-left transition-colors",
                        on ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50",
                      )}
                    >
                      <Icon className={cn("mt-0.5 size-4 shrink-0", on ? "text-primary" : "text-muted-foreground")} />
                      <span className="min-w-0 flex-1">
                        <span className={cn("block text-[13px] font-medium", on ? "text-foreground" : "text-muted-foreground")}>
                          {label}
                        </span>
                        <span className="block text-[10.5px] leading-snug text-muted-foreground/70">{hint}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </Field>

            <Field label="Vehicle">
              <button
                type="button"
                onClick={() => setCodeBased((v) => !v)}
                aria-pressed={codeBased}
                className={cn(
                  "flex w-full items-start gap-2.5 rounded-md border px-3 py-2 text-left transition-colors",
                  codeBased ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50",
                )}
              >
                <Braces className={cn("mt-0.5 size-4 shrink-0", codeBased ? "text-primary" : "text-muted-foreground")} />
                <span className="min-w-0 flex-1">
                  <span className={cn("block text-[13px] font-medium", codeBased ? "text-foreground" : "text-muted-foreground")}>
                    Code / SQL based
                  </span>
                  <span className="block text-[10.5px] leading-snug text-muted-foreground/70">
                    Frame questions around code or SQL snippets (works with either type)
                  </span>
                </span>
                <span className={cn(
                  "mt-0.5 flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition-colors",
                  codeBased ? "bg-primary" : "bg-muted-foreground/30",
                )}>
                  <span className={cn("size-4 rounded-full bg-white transition-transform", codeBased && "translate-x-4")} />
                </span>
              </button>
            </Field>

            {codeBased && (
              <Field label="Code language">
                <select
                  value={language}
                  onChange={(e) => setLanguage(e.target.value as Language)}
                  className="h-10 w-full rounded-md border bg-card px-3 text-sm outline-none focus:ring-2 focus:ring-ring/30"
                >
                  {CODE_LANGS.map((l) => <option key={l} value={l}>{l}</option>)}
                </select>
              </Field>
            )}

            <Field label="Questions">
              <Counter value={count} min={1} max={50} onChange={setCount} />
            </Field>

            <Field label="Difficulty">
              <Segmented value={difficulty} onChange={changeDifficulty} options={DIFFICULTY_OPTIONS} />
            </Field>

            <Field label="Model" hint={!qualityTouched ? "auto" : undefined}>
              <div className="grid grid-cols-3 gap-1.5 rounded-md border bg-card p-0.5">
                {QUALITY_OPTIONS.map(({ value, label, sub, Icon }) => {
                  const active = quality === value;
                  return (
                    <button
                      key={value}
                      type="button"
                      onClick={() => { setQuality(value); setQualityTouched(true); }}
                      className={cn(
                        "flex flex-col items-center gap-0.5 rounded-sm px-2 py-2 transition-colors",
                        active ? "text-white shadow-sm" : "text-muted-foreground hover:bg-muted hover:text-foreground",
                      )}
                      style={active ? { backgroundColor: CLAUDE_ACCENT } : undefined}
                    >
                      <Icon className={cn("size-3.5", active ? "text-white" : "text-muted-foreground")} />
                      <span className="text-xs font-semibold">{label}</span>
                      <span className={cn("text-[9px] uppercase tracking-widest", active ? "text-white/85" : "text-muted-foreground/70")}>{sub}</span>
                    </button>
                  );
                })}
              </div>
            </Field>

            <button
              type="button"
              onClick={() => setGrounding((v) => !v)}
              className="flex w-full items-start gap-2.5 rounded-md border bg-card px-3 py-2.5 text-left transition-colors hover:bg-muted/40"
            >
              <Globe className={cn("mt-0.5 size-4 shrink-0", grounding ? "text-primary" : "text-muted-foreground")} />
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-medium">Ground facts on the web</span>
                <span className="block text-[10.5px] leading-snug text-muted-foreground/70">
                  Fetch reference material so answers rely on real sources (lowers hallucination). ~1 search per run.
                </span>
              </span>
              <span className={cn(
                "mt-0.5 flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition-colors",
                grounding ? "bg-primary" : "bg-muted-foreground/30",
              )}>
                <span className={cn("size-4 rounded-full bg-white transition-transform", grounding && "translate-x-4")} />
              </span>
            </button>

            <Field label="Additional instructions" hint="optional">
              <textarea
                value={extraPrompt}
                onChange={(e) => setExtraPrompt(e.target.value)}
                placeholder={"Anything beyond the standard prompt — e.g.\n• Focus on real production pitfalls\n• Reference AWS services by name"}
                className="scrollbar-thin h-24 w-full resize-y rounded-md border bg-card px-3 py-2 text-sm leading-relaxed outline-none focus:ring-2 focus:ring-ring/30"
              />
            </Field>

            <Field label="Avoid (negative prompt)" hint="optional">
              <textarea
                value={negativePrompt}
                onChange={(e) => setNegativePrompt(e.target.value)}
                placeholder="e.g. avoid trivia about version numbers; no 'all of the above'"
                className="scrollbar-thin h-20 w-full resize-y rounded-md border bg-card px-3 py-2 text-sm leading-relaxed outline-none focus:ring-2 focus:ring-ring/30"
              />
            </Field>

            {/* quality rules (collapsible) */}
            <div className="rounded-md border bg-card">
              <button
                type="button"
                onClick={() => setRulesOpen((v) => !v)}
                className="flex w-full items-center justify-between px-3 py-2.5 text-left"
              >
                <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                  Quality rules{" "}
                  <span className="font-mono normal-case tracking-normal">
                    {applicableRules.filter((r) => enabledRules.has(r.id)).length}/{applicableRules.length}
                  </span>
                </span>
                <Plus className={cn("size-4 text-muted-foreground transition-transform", rulesOpen && "rotate-45")} />
              </button>
              {rulesOpen && (
                <ul className="divide-y divide-border border-t">
                  {applicableRules.map((rule) => {
                    const on = enabledRules.has(rule.id);
                    return (
                      <li key={rule.id}>
                        <button
                          type="button"
                          onClick={() => setEnabledRules((prev) => {
                            const next = new Set(prev);
                            if (next.has(rule.id)) next.delete(rule.id); else next.add(rule.id);
                            return next;
                          })}
                          className="flex w-full items-start gap-2.5 px-3 py-2 text-left transition-colors hover:bg-muted/40"
                        >
                          <span className={cn(
                            "mt-0.5 grid size-4 shrink-0 place-items-center rounded-[5px] border text-[9px]",
                            on ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/40",
                          )}>
                            {on && "✓"}
                          </span>
                          <span className={cn("text-[12px] leading-tight", on ? "text-foreground" : "text-muted-foreground")}>
                            {rule.label}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>

          {/* generate / reset footer */}
          <div className="shrink-0 space-y-2 border-t bg-card/30 px-5 py-3">
            <Button onClick={generate} size="lg" disabled={running} className="w-full">
              {running ? <Loader2 className="animate-spin" /> : <Play />}
              {running ? "Generating…" : started ? "Regenerate" : `Generate ${count} questions`}
            </Button>
            {started && !running && (
              <Button onClick={reset} variant="ghost" size="sm" className="w-full">Clear</Button>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{label}</span>
        {hint && <span className="text-[9px] uppercase tracking-widest text-muted-foreground/70">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

function Counter({ value, min, max, onChange }: { value: number; min: number; max: number; onChange: (n: number) => void }) {
  return (
    <div className="inline-flex h-10 items-stretch overflow-hidden rounded-md border bg-card">
      <button type="button" onClick={() => onChange(Math.max(min, value - 1))} disabled={value <= min}
        className="grid w-10 place-items-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40" aria-label="decrease">
        <Minus className="size-3.5" />
      </button>
      <input type="number" value={value} min={min} max={max}
        onChange={(e) => onChange(Math.max(min, Math.min(max, parseInt(e.target.value) || min)))}
        className="w-14 border-x bg-transparent text-center text-base font-semibold tabular-nums outline-none" />
      <button type="button" onClick={() => onChange(Math.min(max, value + 1))} disabled={value >= max}
        className="grid w-10 place-items-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40" aria-label="increase">
        <Plus className="size-3.5" />
      </button>
    </div>
  );
}

function Segmented<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[] }) {
  return (
    <div className="grid grid-cols-3 gap-1 rounded-md border bg-card p-0.5">
      {options.map((opt) => {
        const active = value === opt.value;
        return (
          <button key={opt.value} type="button" onClick={() => onChange(opt.value)}
            className={cn(
              "rounded-sm py-2 text-xs font-semibold uppercase tracking-widest transition-colors",
              active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}>
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
