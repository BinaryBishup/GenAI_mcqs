"use client";

import { useEffect, useState } from "react";
import { Check, Loader2, Code2 } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { fetchTopic } from "@/lib/api";
import type { Difficulty, SampleTopic, SampleTopicMCQ } from "@/lib/types";

interface Props {
  /** Empty string = closed. */
  filename: string;
  onClose: () => void;
}

const DIFFICULTY_ORDER: Difficulty[] = ["easy", "medium", "hard"];

export function TopicModal({ filename, onClose }: Props) {
  const open = !!filename;
  const [data, setData] = useState<SampleTopic | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [diffFilter, setDiffFilter] = useState<Difficulty | "all">("all");

  useEffect(() => {
    if (!filename) {
      setData(null);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    fetchTopic(filename)
      .then((d) => setData(d))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [filename]);

  const total = data?.count ?? 0;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="flex h-[85vh] max-h-[85vh] flex-col gap-0 overflow-hidden p-0 sm:!max-w-3xl">
        <DialogHeader className="shrink-0 space-y-2 border-b px-6 py-4">
          <DialogTitle className="font-mono text-sm uppercase tracking-wider">
            {filename || "—"}
          </DialogTitle>
          <DialogDescription>
            {loading ? "Loading…" : `${total} sample MCQ${total === 1 ? "" : "s"} in this topic.`}
          </DialogDescription>
          {data && data.count > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              <DifficultyChip
                label="all"
                count={total}
                active={diffFilter === "all"}
                onClick={() => setDiffFilter("all")}
              />
              {DIFFICULTY_ORDER.map((d) => {
                const n = data.by_difficulty[d]?.length ?? 0;
                if (n === 0) return null;
                return (
                  <DifficultyChip
                    key={d}
                    label={d}
                    count={n}
                    active={diffFilter === d}
                    onClick={() => setDiffFilter(d)}
                  />
                );
              })}
            </div>
          )}
        </DialogHeader>

        <div className="scrollbar-thin flex-1 min-h-0 overflow-y-auto px-6 py-4">
          {loading && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Loading questions…
            </p>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
          {data && !loading && (
            <div className="space-y-6">
              {DIFFICULTY_ORDER.map((d) => {
                if (diffFilter !== "all" && diffFilter !== d) return null;
                const items = data.by_difficulty[d] ?? [];
                if (items.length === 0) return null;
                return (
                  <section key={d} className="space-y-3">
                    <h3 className="font-mono text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                      {d} · {items.length}
                    </h3>
                    <ul className="space-y-3">
                      {items.map((m, i) => (
                        <SampleMcqRow key={m.id} mcq={m} index={i} />
                      ))}
                    </ul>
                  </section>
                );
              })}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function DifficultyChip({
  label, count, active, onClick,
}: { label: string; count: number; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "rounded-md border px-2.5 py-1 font-mono text-[11px] uppercase tracking-widest transition-colors",
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      {label} · {count}
    </button>
  );
}

function SampleMcqRow({ mcq, index }: { mcq: SampleTopicMCQ; index: number }) {
  return (
    <li className="overflow-hidden rounded-lg border bg-card">
      <div className="flex flex-wrap items-center gap-1.5 border-b bg-muted/30 px-4 py-2">
        <Badge variant="outline" className="font-mono">Q{index + 1}</Badge>
        <Badge variant="secondary">{mcq.type}</Badge>
        {mcq.language && (
          <Badge variant="outline" className="font-mono">
            <Code2 className="size-3" /> {mcq.language}
          </Badge>
        )}
      </div>
      <div className="space-y-3 p-4">
        <p className="whitespace-pre-wrap text-sm leading-relaxed">{mcq.question}</p>
        {mcq.code?.trim() && (
          <pre className="scrollbar-thin overflow-x-auto rounded-md border bg-muted/40 p-3 text-xs leading-relaxed">
            <code className="font-mono">{mcq.code}</code>
          </pre>
        )}
        <ul className="space-y-1.5">
          {mcq.options.map((opt, i) => {
            const correct = i === mcq.correct_index;
            const letter = String.fromCharCode(65 + i);
            return (
              <li
                key={i}
                className={cn(
                  "flex items-start gap-2.5 rounded-md border px-3 py-1.5 text-sm",
                  correct
                    ? "border-emerald-500/40 bg-emerald-500/5"
                    : "border-border bg-card text-muted-foreground",
                )}
              >
                <span
                  className={cn(
                    "grid size-5 shrink-0 place-items-center rounded-full border text-[10px] font-semibold",
                    correct
                      ? "border-emerald-500 bg-emerald-500 text-white"
                      : "border-border text-muted-foreground",
                  )}
                >
                  {letter}
                </span>
                <span className="min-w-0 flex-1 break-words font-mono text-xs">{opt}</span>
                {correct && (
                  <Check className="size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </li>
  );
}
