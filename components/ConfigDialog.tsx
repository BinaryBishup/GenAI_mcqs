"use client";

import { useEffect, useMemo, useState } from "react";
import { BookOpen, Braces, Check, Code2, Eye, Gauge, Play, RefreshCcw, Sparkles, Zap } from "lucide-react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
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

const QUALITY_LABEL: Record<Quality, string> = {
  fast: "Fast · Haiku",
  balanced: "Balanced · Sonnet",
  highest: "Highest · Opus",
};

const DEFAULT_SAMPLES_PER_FILE = 4;
const DEFAULT_MAX_REVAMP = 3;

export function ConfigDialog({ open, onOpenChange, sampleFiles, onStart, onPreview }: Props) {
  const [topic, setTopic] = useState("");
  const [count, setCount] = useState(5);
  const [difficulty, setDifficulty] = useState<Difficulty>("medium");
  const [quality, setQuality] = useState<Quality>("fast");
  const [qualityTouched, setQualityTouched] = useState(false);
  const [negativePrompt, setNegativePrompt] = useState("");
  const [customPrompt, setCustomPrompt] = useState("");
  const [customPromptTouched, setCustomPromptTouched] = useState(false);

  // Detected metadata for the selected sample file.
  const [meta, setMeta] = useState<SampleCatalogItem | null>(null);
  const [sampleMcq, setSampleMcq] = useState<SampleTopicMCQ | null>(null);

  const filename = sampleFiles[0] ?? "";
  const detectedType: MCQType = meta?.primary_type ?? "general";
  const detectedLang = meta?.primary_language ?? null;

  // Reset on open and load metadata when the picked filename changes.
  useEffect(() => {
    if (!open) return;
    setNegativePrompt("");
    setCustomPrompt("");
    setCustomPromptTouched(false);
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
        // Pick a representative sample — prefer medium difficulty, fall back to anything.
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

  // Built prompt updates live until the user edits it.
  const builtVisible = useMemo(() => {
    return buildVisible({
      count,
      topic,
      difficulty,
      mcqType: detectedType,
      languages: detectedLang ? [detectedLang as Language] : [],
      negativePrompt,
    });
  }, [count, topic, difficulty, detectedType, detectedLang, negativePrompt]);

  const promptValue = customPromptTouched ? customPrompt : builtVisible;

  function submit() {
    if (!topic.trim()) {
      alert("Set a topic for the new questions.");
      return;
    }
    const languages: Language[] = detectedType === "code" && detectedLang
      ? [detectedLang as Language]
      : [];
    onStart({
      count,
      topic,
      difficulty,
      mcq_type: detectedType,
      languages,
      samples: [],
      sample_files: sampleFiles,
      samples_per_file: DEFAULT_SAMPLES_PER_FILE,
      max_revamp_attempts: DEFAULT_MAX_REVAMP,
      quality,
      negative_prompt: negativePrompt.trim() || undefined,
      custom_prompt: customPromptTouched ? customPrompt.trim() : undefined,
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="grid max-w-[1100px] grid-cols-1 gap-0 overflow-hidden p-0 lg:grid-cols-[1fr_360px]">
        <div className="flex flex-col gap-5 px-7 py-6">
          <DialogHeader className="space-y-1.5 p-0">
            <DialogTitle>Configure generation</DialogTitle>
            <DialogDescription>
              From {sampleFiles.length} sample topic{sampleFiles.length === 1 ? "" : "s"}.
            </DialogDescription>
          </DialogHeader>

          {/* topic */}
          <div className="space-y-2">
            <Label htmlFor="topic">Topic for new questions</Label>
            <Input
              id="topic"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="e.g. Python list slicing and indexing"
              className="h-11"
              autoFocus
            />
          </div>

          {/* count / difficulty / quality */}
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="count">Count</Label>
              <Input
                id="count"
                type="number"
                min={1}
                max={50}
                value={count}
                onChange={(e) => setCount(Math.max(1, Math.min(50, parseInt(e.target.value) || 1)))}
                className="h-11 text-center text-base font-medium"
              />
            </div>
            <div className="space-y-2">
              <Label>Difficulty</Label>
              <Select value={difficulty} onValueChange={(v) => changeDifficulty(v as Difficulty)}>
                <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="easy">easy</SelectItem>
                  <SelectItem value="medium">medium</SelectItem>
                  <SelectItem value="hard">hard</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="flex items-center gap-1.5">
                Quality
                {!qualityTouched && (
                  <span className="text-[10px] uppercase tracking-widest text-muted-foreground">auto</span>
                )}
              </Label>
              <Select
                value={quality}
                onValueChange={(v) => { setQuality(v as Quality); setQualityTouched(true); }}
              >
                <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="fast">
                    <span className="inline-flex items-center gap-2"><Zap className="size-3.5" />{QUALITY_LABEL.fast}</span>
                  </SelectItem>
                  <SelectItem value="balanced">
                    <span className="inline-flex items-center gap-2"><Gauge className="size-3.5" />{QUALITY_LABEL.balanced}</span>
                  </SelectItem>
                  <SelectItem value="highest">
                    <span className="inline-flex items-center gap-2"><Sparkles className="size-3.5" />{QUALITY_LABEL.highest}</span>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* detected type + language */}
          <div className="rounded-md border bg-muted/30 px-4 py-3">
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
              Detected from samples
            </p>
            <div className="flex flex-wrap items-center gap-2">
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
              <span className="ml-auto text-[11px] text-muted-foreground">
                Inferred from this sample file — no override needed.
              </span>
            </div>
          </div>

          {/* prompt preview / edit */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="prompt" className="flex items-center gap-1.5">
                Prompt
                {customPromptTouched && (
                  <Badge variant="outline" className="text-[10px]">edited</Badge>
                )}
              </Label>
              {customPromptTouched && (
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => { setCustomPrompt(""); setCustomPromptTouched(false); }}
                >
                  <RefreshCcw />
                  Reset
                </Button>
              )}
            </div>
            <textarea
              id="prompt"
              value={promptValue}
              onChange={(e) => { setCustomPrompt(e.target.value); setCustomPromptTouched(true); }}
              rows={6}
              className="scrollbar-thin w-full rounded-md border bg-card px-3 py-2 font-mono text-xs leading-relaxed focus:outline-none focus:ring-2 focus:ring-ring/30"
            />
            <p className="text-[11px] text-muted-foreground">
              Sent after the sample MCQs from the picked topic. Edit freely; the JSON-output rules in the system prompt are kept regardless.
            </p>
          </div>

          {/* negative prompt */}
          <div className="space-y-2">
            <Label htmlFor="negative">Negative prompt (things to avoid)</Label>
            <textarea
              id="negative"
              value={negativePrompt}
              onChange={(e) => setNegativePrompt(e.target.value)}
              rows={3}
              placeholder="e.g. don't use list.append; avoid questions about map/filter/reduce"
              className="scrollbar-thin w-full rounded-md border bg-card px-3 py-2 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-ring/30"
            />
          </div>

          <DialogFooter className="mt-1 p-0">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button onClick={submit} size="lg">
              <Play />
              Start workflow
            </Button>
          </DialogFooter>
        </div>

        {/* right pane: sample preview */}
        <aside className="hidden flex-col border-l bg-muted/20 lg:flex">
          <div className="flex shrink-0 items-center justify-between border-b px-5 py-3">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
              Sample
            </p>
            {filename && (
              <Button variant="outline" size="xs" onClick={() => onPreview(filename)}>
                <Eye />
                View all
              </Button>
            )}
          </div>
          <div className="scrollbar-thin flex-1 min-h-0 overflow-y-auto px-5 py-4">
            {!sampleMcq ? (
              <p className="text-xs text-muted-foreground">No sample loaded.</p>
            ) : (
              <SamplePreviewCard mcq={sampleMcq} />
            )}
          </div>
        </aside>
      </DialogContent>
    </Dialog>
  );
}

function SamplePreviewCard({ mcq }: { mcq: SampleTopicMCQ }) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant="secondary">{mcq.type}</Badge>
        <Badge variant="outline" className="font-mono">{mcq.difficulty}</Badge>
        {mcq.language && (
          <Badge variant="outline" className="font-mono">
            <Code2 className="size-3" /> {mcq.language}
          </Badge>
        )}
      </div>
      <p className="whitespace-pre-wrap text-xs leading-relaxed">{mcq.question}</p>
      {mcq.code?.trim() && (
        <pre className="scrollbar-thin overflow-x-auto rounded-md border bg-card p-2 text-[11px] leading-relaxed">
          <code className="font-mono">{mcq.code}</code>
        </pre>
      )}
      <ul className="space-y-1">
        {mcq.options.map((opt, i) => {
          const correct = i === mcq.correct_index;
          const letter = String.fromCharCode(65 + i);
          return (
            <li
              key={i}
              className={cn(
                "flex items-start gap-2 rounded-md border px-2 py-1 text-[11px]",
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
  );
}

function buildVisible(args: {
  count: number;
  topic: string;
  difficulty: Difficulty;
  mcqType: MCQType;
  languages: Language[];
  negativePrompt?: string;
}): string {
  const langs = args.mcqType === "code" && args.languages.length > 0
    ? `Languages allowed: ${args.languages.join(", ")}. Pick one language per question; vary across the set.`
    : "";
  const avoid = args.negativePrompt?.trim()
    ? `\nAvoid the following:\n${args.negativePrompt.trim()}`
    : "";
  return [
    `Generate ${args.count} novel MCQs.`,
    `Topic: ${args.topic || "<set a topic above>"}`,
    `Difficulty: ${args.difficulty}`,
    `Type: ${args.mcqType}`,
    langs,
    avoid,
    "",
    "Output: a JSON array, exactly the schema in the system message. No prose.",
  ].filter(Boolean).join("\n");
}
