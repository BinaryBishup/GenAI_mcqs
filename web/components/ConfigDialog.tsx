"use client";

import { useState } from "react";
import { BookOpen, Braces, Gauge, Play, Sparkles, Zap } from "lucide-react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { Difficulty, GenerateRequest, Language, MCQType, Quality } from "@/lib/types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sampleFiles: string[];
  onStart: (req: GenerateRequest) => void;
}

const ALL_LANGS: Language[] = ["python", "java", "cpp", "c", "csharp", "javascript", "html", "css"];

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

// Sensible defaults for fields we no longer expose in the UI.
const DEFAULT_SAMPLES_PER_FILE = 4;
const DEFAULT_MAX_REVAMP = 3;

export function ConfigDialog({ open, onOpenChange, sampleFiles, onStart }: Props) {
  const [topic, setTopic] = useState("");
  const [count, setCount] = useState(5);
  const [difficulty, setDifficulty] = useState<Difficulty>("medium");
  const [mcqType, setMcqType] = useState<MCQType>("general");
  const [languages, setLanguages] = useState<Language[]>(["python"]);
  const [quality, setQuality] = useState<Quality>("fast");
  const [qualityTouched, setQualityTouched] = useState(false);

  function changeDifficulty(d: Difficulty) {
    setDifficulty(d);
    if (!qualityTouched) setQuality(QUALITY_BY_DIFFICULTY[d]);
  }

  function toggleLang(l: Language) {
    setLanguages((p) => (p.includes(l) ? p.filter((x) => x !== l) : [...p, l]));
  }

  function submit() {
    if (!topic.trim()) {
      alert("Set a topic for the new questions.");
      return;
    }
    onStart({
      count,
      topic,
      difficulty,
      mcq_type: mcqType,
      languages,
      samples: [],
      sample_files: sampleFiles,
      samples_per_file: DEFAULT_SAMPLES_PER_FILE,
      max_revamp_attempts: DEFAULT_MAX_REVAMP,
      quality,
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Configure generation</DialogTitle>
          <DialogDescription>
            From {sampleFiles.length} sample topic{sampleFiles.length === 1 ? "" : "s"}.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-2">
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

          <div className="space-y-2">
            <Label>Type</Label>
            <TypeToggle value={mcqType} onChange={setMcqType} />
          </div>

          {mcqType === "code" && (
            <div className="space-y-2">
              <Label>Languages</Label>
              <div className="flex flex-wrap gap-1.5">
                {ALL_LANGS.map((l) => {
                  const on = languages.includes(l);
                  return (
                    <button
                      key={l}
                      type="button"
                      onClick={() => toggleLang(l)}
                      className={cn(
                        "rounded-md border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-widest transition-colors",
                        on
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground",
                      )}
                    >
                      {l}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} size="lg">
            <Play />
            Start workflow
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TypeToggle({
  value, onChange,
}: { value: MCQType; onChange: (v: MCQType) => void }) {
  const opts: { value: MCQType; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { value: "general", label: "General", icon: BookOpen },
    { value: "code", label: "Code", icon: Braces },
  ];
  return (
    <div className="grid grid-cols-2 gap-3">
      {opts.map(({ value: v, label, icon: Icon }) => {
        const on = value === v;
        return (
          <button
            key={v}
            type="button"
            onClick={() => onChange(v)}
            className={cn(
              "flex items-center justify-center gap-2 rounded-md border px-3 py-3 text-sm font-medium transition-colors",
              on
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-card text-foreground hover:bg-muted",
            )}
          >
            <Icon className="size-4" />
            {label}
          </button>
        );
      })}
    </div>
  );
}
