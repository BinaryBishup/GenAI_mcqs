"use client";

import { useEffect, useState } from "react";
import {
  BookOpen, Braces, Check, Code2, Eye, Gauge, Minus, Play, Plus, Sparkles, X, Zap,
} from "lucide-react";
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
  const [batchName, setBatchName] = useState("");
  const [count, setCount] = useState(5);
  const [difficulty, setDifficulty] = useState<Difficulty>("medium");
  const [quality, setQuality] = useState<Quality>("fast");
  const [qualityTouched, setQualityTouched] = useState(false);
  const [negativePrompt, setNegativePrompt] = useState("");
  const [extraPrompt, setExtraPrompt] = useState("");

  const [meta, setMeta] = useState<SampleCatalogItem | null>(null);
  const [sampleMcq, setSampleMcq] = useState<SampleTopicMCQ | null>(null);

  const filename = sampleFiles[0] ?? "";
  const detectedType: MCQType = meta?.primary_type ?? "general";
  const detectedLang = meta?.primary_language ?? null;

  useEffect(() => {
    if (!open) return;
    setBatchName("");
    setNegativePrompt("");
    setExtraPrompt("");
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

  function submit() {
    if (!batchName.trim()) {
      alert("Name this batch (e.g. \"Python list slicing\").");
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
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="flex max-h-[92vh] flex-col gap-0 overflow-hidden p-0 sm:!max-w-[960px]"
      >
        {/* HEADER — topic + detected type, no generic title */}
        <header className="shrink-0 border-b px-7 py-4">
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
        </header>

        {/* BODY — 2 cols */}
        <div className="grid flex-1 min-h-0 grid-cols-1 overflow-hidden lg:grid-cols-[440px_1fr]">
          {/* LEFT — config + sample preview */}
          <section className="scrollbar-thin min-h-0 overflow-y-auto border-b px-7 py-6 lg:border-b-0 lg:border-r">
            <div className="space-y-6">
              {/* batch name */}
              <Field label="Batch name">
                <Input
                  value={batchName}
                  onChange={(e) => setBatchName(e.target.value)}
                  placeholder="e.g. Python list slicing"
                  className="h-10"
                  autoFocus
                />
              </Field>

              {/* count counter */}
              <Field label="Questions">
                <Counter value={count} min={1} max={50} onChange={setCount} />
              </Field>

              {/* difficulty toggle */}
              <Field label="Difficulty">
                <SegmentedControl
                  value={difficulty}
                  onChange={(v) => changeDifficulty(v)}
                  options={DIFFICULTY_OPTIONS}
                />
              </Field>

              {/* quality (Claude model) — Claude coral on selected */}
              <Field
                label="Model"
                hint={!qualityTouched ? "auto" : undefined}
              >
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

              {/* sample preview — moved here so the right column has room for prompts */}
              {sampleMcq && (
                <div className="space-y-2 pt-2">
                  <div className="flex items-center justify-between">
                    <Label>Sample from this topic</Label>
                    {filename && (
                      <Button variant="outline" size="xs" onClick={() => onPreview(filename)}>
                        <Eye />
                        View all
                      </Button>
                    )}
                  </div>
                  <SamplePreviewCard mcq={sampleMcq} />
                </div>
              )}
            </div>
          </section>

          {/* RIGHT — extra instructions + negative prompt */}
          <section className="scrollbar-thin min-h-0 overflow-y-auto bg-muted/10 px-7 py-6">
            <div className="flex h-full flex-col gap-6">
              {/* extra instructions — grows */}
              <div className="flex min-h-0 flex-1 flex-col gap-2">
                <Label>Additional instructions <span className="font-normal normal-case tracking-normal text-muted-foreground">(optional)</span></Label>
                <textarea
                  value={extraPrompt}
                  onChange={(e) => setExtraPrompt(e.target.value)}
                  placeholder={`Anything beyond the standard prompt — e.g.\n• Focus on edge cases with empty inputs\n• Each question should reference a real-world scenario\n• Use single-letter variable names\n\nLeave blank for the default behaviour.`}
                  className="scrollbar-thin min-h-[200px] w-full flex-1 resize-none rounded-md border bg-card px-3 py-2 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-ring/30"
                />
                <p className="text-[10px] text-muted-foreground">
                  Appended to the standard prompt. The samples block, JSON schema, count, topic, difficulty, and type are all wired up automatically.
                </p>
              </div>

              {/* negative prompt */}
              <div className="space-y-2">
                <Label>Avoid (negative prompt)</Label>
                <textarea
                  value={negativePrompt}
                  onChange={(e) => setNegativePrompt(e.target.value)}
                  rows={4}
                  placeholder="e.g. don't use list.append; avoid questions about map/filter/reduce"
                  className="scrollbar-thin w-full resize-none rounded-md border bg-card px-3 py-2 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-ring/30"
                />
              </div>
            </div>
          </section>
        </div>

        {/* FOOTER */}
        <footer className="flex shrink-0 items-center justify-end gap-2 border-t bg-card/30 px-7 py-3">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} size="lg">
            <Play />
            Start workflow
          </Button>
        </footer>
      </DialogContent>
    </Dialog>
  );
}

// -----------------------------------------------------------------------------
// Building blocks
// -----------------------------------------------------------------------------

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

