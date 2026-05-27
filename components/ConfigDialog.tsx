"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft, ArrowRight, BookOpen, Braces, Check, Code2, Eye, Gauge, Minus, Play,
  Plus, Sparkles, X, Zap,
} from "lucide-react";
import { QUALITY_RULES, DEFAULT_RULE_IDS } from "@/lib/prompts";
import {
  Dialog, DialogContent, DialogTitle, DialogClose,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { fetchCatalog, fetchTopic } from "@/lib/api";
import type {
  Difficulty, GenerateRequest, Language, MCQType, Quality,
  SampleCatalogItem, SampleTopicMCQ,
} from "@/lib/types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sampleFiles: string[];
  onStart: (req: GenerateRequest) => void;
  onPreview: (filename: string) => void;
}

const QUALITY_BY_DIFFICULTY: Record<Difficulty, Quality> = {
  easy: "fast",
  medium: "fast",
  hard: "balanced",
};

// Anthropic accent — used only on the selected model chip.
const CLAUDE_ACCENT = "#d97757";

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

const DEFAULT_SAMPLES_PER_FILE = 4;
const DEFAULT_MAX_REVAMP = 3;

export function ConfigDialog({ open, onOpenChange, sampleFiles, onStart, onPreview }: Props) {
  const [step, setStep] = useState<1 | 2>(1);
  const [batchName, setBatchName] = useState("");
  const [nameError, setNameError] = useState(false);
  const [count, setCount] = useState(5);
  const [difficulty, setDifficulty] = useState<Difficulty>("medium");
  const [quality, setQuality] = useState<Quality>("fast");
  const [qualityTouched, setQualityTouched] = useState(false);
  const [negativePrompt, setNegativePrompt] = useState("");
  const [extraPrompt, setExtraPrompt] = useState("");
  const [enabledRules, setEnabledRules] = useState<Set<string>>(() => new Set(DEFAULT_RULE_IDS));

  const [meta, setMeta] = useState<SampleCatalogItem | null>(null);
  const [sampleMcq, setSampleMcq] = useState<SampleTopicMCQ | null>(null);

  const filename = sampleFiles[0] ?? "";
  const detectedType: MCQType = meta?.primary_type ?? "general";
  const detectedLang = meta?.primary_language ?? null;

  useEffect(() => {
    if (!open) return;
    setStep(1);
    setBatchName("");
    setNameError(false);
    setNegativePrompt("");
    setExtraPrompt("");
    setEnabledRules(new Set(DEFAULT_RULE_IDS));
  }, [open]);

  useEffect(() => {
    if (!filename) {
      setMeta(null);
      setSampleMcq(null);
      return;
    }
    fetchCatalog()
      .then((cat) => cat.items.find((i) => i.filename === filename) ?? null)
      .then(setMeta)
      .catch(() => setMeta(null));
    fetchTopic(filename)
      .then((t) => {
        const buckets = t.by_difficulty;
        const pick = (buckets.medium?.[0] ?? buckets.easy?.[0] ?? buckets.hard?.[0]) ?? null;
        setSampleMcq(pick);
      })
      .catch(() => setSampleMcq(null));
  }, [filename]);

  function changeDifficulty(d: Difficulty) {
    setDifficulty(d);
    if (!qualityTouched) setQuality(QUALITY_BY_DIFFICULTY[d]);
  }

  function goNext() {
    if (!batchName.trim()) {
      setNameError(true);
      return;
    }
    setNameError(false);
    setStep(2);
  }

  function submit() {
    if (!batchName.trim()) {
      setStep(1);
      setNameError(true);
      return;
    }
    const languages: Language[] = detectedType === "code" && detectedLang
      ? [detectedLang as Language]
      : [];
    onStart({
      count,
      topic: batchName,
      difficulty,
      mcq_type: detectedType,
      languages,
      samples: [],
      sample_files: sampleFiles,
      samples_per_file: DEFAULT_SAMPLES_PER_FILE,
      max_revamp_attempts: DEFAULT_MAX_REVAMP,
      quality,
      extra_prompt: extraPrompt.trim() || undefined,
      negative_prompt: negativePrompt.trim() || undefined,
      quality_rules: [...enabledRules],
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="flex max-h-[92vh] w-[calc(100vw-1.5rem)] flex-col gap-0 overflow-hidden p-0 sm:!max-w-[960px]"
      >
        {/* HEADER — source + step indicator */}
        <header className="shrink-0 border-b px-5 py-4 sm:px-7">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <DialogTitle className="sr-only">Configure generation</DialogTitle>
              <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                Source sample
              </p>
              <p className="mt-1 truncate text-base font-semibold tracking-tight">
                {meta?.topic ?? filename ?? "—"}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {meta && (
                  <>
                    <Badge variant="outline" className="font-mono">
                      {meta.count} samples
                    </Badge>
                    <Badge variant={detectedType === "code" ? "default" : "secondary"}>
                      {detectedType === "code"
                        ? <><Braces className="size-3" /> code</>
                        : <><BookOpen className="size-3" /> general</>}
                    </Badge>
                    {detectedType === "code" && detectedLang && (
                      <Badge variant="outline" className="font-mono">
                        <Code2 className="size-3" /> {detectedLang}
                      </Badge>
                    )}
                  </>
                )}
              </div>
            </div>
            <DialogClose asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Close">
                <X />
              </Button>
            </DialogClose>
          </div>

          {/* stepper */}
          <div className="mt-4 flex items-center gap-2">
            <StepPill index={1} label="Setup" active={step === 1} done={step > 1} onClick={() => setStep(1)} />
            <div className={cn("h-px flex-1", step > 1 ? "bg-primary" : "bg-border")} />
            <StepPill index={2} label="Prompt & rules" active={step === 2} done={false} onClick={goNext} />
          </div>
        </header>

        {/* BODY — one scroll region on mobile, two independent panes on lg+ */}
        <div className="grid flex-1 min-h-0 grid-cols-1 overflow-y-auto lg:overflow-hidden lg:grid-cols-[minmax(0,440px)_1fr]">
          {step === 1 ? (
            <>
              {/* LEFT — basic config */}
              <section className="scrollbar-thin overflow-visible border-b px-5 py-6 sm:px-7 lg:min-h-0 lg:overflow-y-auto lg:border-b-0 lg:border-r">
                <div className="space-y-6">
                  <Field label="Batch name">
                    <Input
                      value={batchName}
                      onChange={(e) => { setBatchName(e.target.value); if (nameError) setNameError(false); }}
                      onKeyDown={(e) => { if (e.key === "Enter") goNext(); }}
                      placeholder="e.g. Python list slicing"
                      className={cn("h-10", nameError && "border-destructive focus-visible:ring-destructive/30")}
                      autoFocus
                    />
                    {nameError && (
                      <p className="text-[11px] text-destructive">Give this batch a name to continue.</p>
                    )}
                  </Field>

                  <Field label="Questions">
                    <Counter value={count} min={1} max={50} onChange={setCount} />
                  </Field>

                  <Field label="Difficulty">
                    <SegmentedControl
                      value={difficulty}
                      onChange={(v) => changeDifficulty(v)}
                      options={DIFFICULTY_OPTIONS}
                    />
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
                              "group flex flex-col items-center gap-0.5 rounded-sm px-2 py-2 transition-colors",
                              active
                                ? "text-white shadow-sm"
                                : "text-muted-foreground hover:bg-muted hover:text-foreground",
                            )}
                            style={active ? { backgroundColor: CLAUDE_ACCENT } : undefined}
                          >
                            <Icon className={cn("size-3.5", active ? "text-white" : "text-muted-foreground")} />
                            <span className="text-xs font-semibold">{label}</span>
                            <span className={cn(
                              "text-[9px] uppercase tracking-widest",
                              active ? "text-white/85" : "text-muted-foreground/70",
                            )}>
                              {sub}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </Field>
                </div>
              </section>

              {/* RIGHT — sample preview */}
              <section className="scrollbar-thin overflow-visible bg-muted/10 px-5 py-6 sm:px-7 lg:min-h-0 lg:overflow-y-auto">
                <div className="flex items-center justify-between">
                  <Label>Sample from this topic</Label>
                  {filename && (
                    <Button variant="outline" size="xs" onClick={() => onPreview(filename)}>
                      <Eye />
                      View all
                    </Button>
                  )}
                </div>
                <div className="mt-2">
                  {sampleMcq
                    ? <SamplePreviewCard mcq={sampleMcq} />
                    : <p className="py-12 text-center text-sm text-muted-foreground">No sample preview available.</p>}
                </div>
              </section>
            </>
          ) : (
            <>
              {/* LEFT — prompts */}
              <section className="scrollbar-thin overflow-visible border-b px-5 py-6 sm:px-7 lg:min-h-0 lg:overflow-y-auto lg:border-b-0 lg:border-r">
                <div className="flex flex-col gap-6">
                  <div className="flex flex-col gap-2">
                    <Label>
                      Additional instructions{" "}
                      <span className="font-normal normal-case tracking-normal text-muted-foreground">(optional)</span>
                    </Label>
                    <textarea
                      value={extraPrompt}
                      onChange={(e) => setExtraPrompt(e.target.value)}
                      placeholder={`Anything beyond the standard prompt — e.g.\n• Focus on edge cases with empty inputs\n• Each question should reference a real-world scenario\n• Use single-letter variable names\n\nLeave blank for the default behaviour.`}
                      className="scrollbar-thin h-44 w-full resize-y rounded-md border bg-card px-3 py-2 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-ring/30 lg:h-56"
                    />
                    <p className="text-[10px] text-muted-foreground">
                      Appended to the standard prompt. Samples, JSON schema, count, topic, difficulty, and type are wired up automatically.
                    </p>
                  </div>

                  <div className="flex flex-col gap-2">
                    <Label>Avoid (negative prompt)</Label>
                    <textarea
                      value={negativePrompt}
                      onChange={(e) => setNegativePrompt(e.target.value)}
                      placeholder="e.g. don't use list.append; avoid questions about map/filter/reduce"
                      className="scrollbar-thin h-24 w-full resize-y rounded-md border bg-card px-3 py-2 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-ring/30"
                    />
                  </div>
                </div>
              </section>

              {/* RIGHT — quality rules as bullet checkboxes */}
              <section className="scrollbar-thin overflow-visible bg-muted/10 px-5 py-6 sm:px-7 lg:min-h-0 lg:overflow-y-auto">
                <QualityRulesPicker
                  mcqType={detectedType}
                  enabled={enabledRules}
                  onChange={setEnabledRules}
                />
              </section>
            </>
          )}
        </div>

        {/* FOOTER */}
        <footer className="flex shrink-0 items-center justify-between gap-2 border-t bg-card/30 px-5 py-3 sm:px-7">
          {step === 1 ? (
            <>
              <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button onClick={goNext} size="lg">
                Next
                <ArrowRight />
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" onClick={() => setStep(1)}>
                <ArrowLeft />
                Back
              </Button>
              <Button onClick={submit} size="lg">
                <Play />
                Start workflow
              </Button>
            </>
          )}
        </footer>
      </DialogContent>
    </Dialog>
  );
}

// -----------------------------------------------------------------------------
// Building blocks
// -----------------------------------------------------------------------------

function StepPill({
  index, label, active, done, onClick,
}: { index: number; label: string; active: boolean; done: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-2 rounded-full py-1 pl-1 pr-3 text-left transition-colors",
        active ? "bg-primary/10" : "hover:bg-muted",
      )}
    >
      <span
        className={cn(
          "grid size-6 shrink-0 place-items-center rounded-full text-[11px] font-semibold",
          active
            ? "bg-primary text-primary-foreground"
            : done
              ? "bg-primary/20 text-primary"
              : "bg-muted text-muted-foreground",
        )}
      >
        {done ? <Check className="size-3.5" /> : index}
      </span>
      <span className={cn(
        "text-[11px] font-semibold uppercase tracking-widest",
        active ? "text-foreground" : "text-muted-foreground",
      )}>
        {label}
      </span>
    </button>
  );
}

function Label({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={cn("text-[10px] font-semibold uppercase tracking-widest text-muted-foreground", className)}>
      {children}
    </span>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <Label>{label}</Label>
        {hint && (
          <span className="text-[9px] uppercase tracking-widest text-muted-foreground">
            {hint}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

function Counter({
  value, min, max, onChange,
}: { value: number; min: number; max: number; onChange: (n: number) => void }) {
  const dec = () => onChange(Math.max(min, value - 1));
  const inc = () => onChange(Math.min(max, value + 1));
  return (
    <div className="inline-flex h-10 items-stretch overflow-hidden rounded-md border bg-card">
      <button
        type="button"
        onClick={dec}
        disabled={value <= min}
        className="grid w-10 place-items-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
        aria-label="decrease"
      >
        <Minus className="size-3.5" />
      </button>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(Math.max(min, Math.min(max, parseInt(e.target.value) || min)))}
        min={min}
        max={max}
        className="w-14 border-x bg-transparent text-center text-base font-semibold tabular-nums outline-none"
      />
      <button
        type="button"
        onClick={inc}
        disabled={value >= max}
        className="grid w-10 place-items-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
        aria-label="increase"
      >
        <Plus className="size-3.5" />
      </button>
    </div>
  );
}

function SegmentedControl<T extends string>({
  value, onChange, options,
}: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[] }) {
  return (
    <div className="grid grid-cols-3 gap-1 rounded-md border bg-card p-0.5">
      {options.map((opt) => {
        const active = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={cn(
              "rounded-sm py-2 text-xs font-semibold uppercase tracking-widest transition-colors",
              active
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function SamplePreviewCard({ mcq }: { mcq: SampleTopicMCQ }) {
  return (
    <div className="overflow-hidden rounded-md border bg-card">
      <div className="flex flex-wrap items-center gap-1.5 border-b bg-muted/40 px-3 py-2">
        <Badge variant="outline" className="font-mono text-[10px]">{mcq.difficulty}</Badge>
        {mcq.language && (
          <Badge variant="outline" className="font-mono text-[10px]">
            <Code2 className="size-3" /> {mcq.language}
          </Badge>
        )}
      </div>
      <div className="space-y-3 p-3">
        <p className="whitespace-pre-wrap text-[12px] leading-relaxed">{mcq.question}</p>
        {mcq.code?.trim() && (
          <pre className="scrollbar-thin overflow-x-auto rounded-md border bg-muted/40 p-2 text-[10.5px] leading-relaxed">
            <code className="font-mono">{mcq.code}</code>
          </pre>
        )}
        <ul className="grid grid-cols-1 gap-1 sm:grid-cols-2">
          {mcq.options.map((opt, i) => {
            const correct = i === mcq.correct_index;
            const letter = String.fromCharCode(65 + i);
            return (
              <li
                key={i}
                className={cn(
                  "flex items-start gap-1.5 rounded-md border px-2 py-1.5 text-[11px]",
                  correct
                    ? "border-emerald-500/40 bg-emerald-500/5"
                    : "border-border bg-card text-muted-foreground",
                )}
              >
                <span
                  className={cn(
                    "grid size-4 shrink-0 place-items-center rounded-full border text-[9px] font-semibold",
                    correct
                      ? "border-emerald-500 bg-emerald-500 text-white"
                      : "border-border text-muted-foreground",
                  )}
                >
                  {letter}
                </span>
                <span className="min-w-0 flex-1 break-words font-mono">{opt}</span>
                {correct && (
                  <Check className="size-3 shrink-0 text-emerald-600 dark:text-emerald-400" />
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

function QualityRulesPicker({
  mcqType, enabled, onChange,
}: {
  mcqType: MCQType;
  enabled: Set<string>;
  onChange: (next: Set<string>) => void;
}) {
  const applicable = useMemo(
    () => QUALITY_RULES.filter((r) => !r.appliesTo || r.appliesTo === mcqType),
    [mcqType],
  );
  const enabledApplicable = applicable.filter((r) => enabled.has(r.id)).length;

  function toggle(id: string) {
    const next = new Set(enabled);
    if (next.has(id)) next.delete(id); else next.add(id);
    onChange(next);
  }

  function setAll(on: boolean) {
    if (on) onChange(new Set(applicable.map((r) => r.id)));
    else onChange(new Set());
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label>
          Quality rules{" "}
          <span className="font-mono normal-case tracking-normal text-muted-foreground">
            {enabledApplicable}/{applicable.length}
          </span>
        </Label>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setAll(true)}
            className="rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            All
          </button>
          <span className="text-muted-foreground/40">·</span>
          <button
            type="button"
            onClick={() => setAll(false)}
            className="rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            None
          </button>
        </div>
      </div>

      <ul className="divide-y divide-border overflow-hidden rounded-md border bg-card">
        {applicable.map((rule) => {
          const on = enabled.has(rule.id);
          return (
            <li key={rule.id}>
              <button
                type="button"
                onClick={() => toggle(rule.id)}
                aria-pressed={on}
                className="flex w-full items-start gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-muted/50"
              >
                <span
                  className={cn(
                    "mt-0.5 grid size-4 shrink-0 place-items-center rounded-[5px] border transition-colors",
                    on
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-muted-foreground/40 bg-transparent",
                  )}
                >
                  {on && <Check className="size-3" strokeWidth={3} />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className={cn(
                    "block text-[12px] font-medium leading-tight",
                    on ? "text-foreground" : "text-muted-foreground",
                  )}>
                    {rule.label}
                  </span>
                  <span className="mt-0.5 block text-[10.5px] leading-snug text-muted-foreground/70">
                    {ruleSummary(rule.text)}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <p className="text-[10px] text-muted-foreground">
        Toggle a rule on or off. Disabled rules are omitted from the prompt sent to Claude.
      </p>
    </div>
  );
}

/** First sentence of a rule's full text — enough context without the wall of words. */
function ruleSummary(text: string): string {
  const afterColon = text.includes(":") ? text.split(":").slice(1).join(":") : text;
  const firstSentence = afterColon.split(/(?<=\.)\s/)[0].trim();
  return firstSentence.length > 120 ? firstSentence.slice(0, 117) + "…" : firstSentence;
}
