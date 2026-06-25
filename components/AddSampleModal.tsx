"use client";

import { useEffect, useRef, useState } from "react";
import {
  Check, Code2, FileSpreadsheet, Loader2, Plus, RotateCcw, Upload, X,
} from "lucide-react";
import {
  Dialog, DialogContent, DialogTitle, DialogClose,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { previewSample, uploadSample, type UploadSampleResult } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { Difficulty, SamplePreviewMCQ, SamplePreviewResult } from "@/lib/types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after a successful upload so the catalog can refresh. */
  onUploaded: (result: UploadSampleResult) => void;
}

const DIFFICULTY_ORDER: Difficulty[] = ["easy", "medium", "hard"];

export function AddSampleModal({ open, onOpenChange, onUploaded }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [topic, setTopic] = useState("");
  const [dragging, setDragging] = useState(false);
  const [preview, setPreview] = useState<SamplePreviewResult | null>(null);
  const [parsing, setParsing] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [diffFilter, setDiffFilter] = useState<Difficulty | "all">("all");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function reset() {
    setFile(null);
    setTopic("");
    setDragging(false);
    setPreview(null);
    setParsing(false);
    setCommitting(false);
    setDiffFilter("all");
    setError(null);
  }

  useEffect(() => {
    if (open) reset();
  }, [open]);

  async function pickFile(f: File | null) {
    setError(null);
    setPreview(null);
    setDiffFilter("all");
    if (!f) return;
    if (!/\.xlsx?$/i.test(f.name)) {
      setError("Please choose a .xls or .xlsx workbook.");
      return;
    }
    const derived = f.name.replace(/\.xlsx?$/i, "").replace(/[-_]+/g, " ").trim();
    setFile(f);
    setTopic(derived);
    await runPreview(f, derived);
  }

  async function runPreview(f: File, t: string) {
    setParsing(true);
    setError(null);
    try {
      const res = await previewSample(f, t);
      setPreview(res);
      if (!t.trim() && res.topic) setTopic(res.topic);
    } catch (e) {
      setPreview(null);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setParsing(false);
    }
  }

  async function submit() {
    if (!file) { setError("Choose a workbook to upload."); return; }
    if (!topic.trim()) { setError("Give this sample set a topic name."); return; }
    setCommitting(true);
    setError(null);
    try {
      const result = await uploadSample(file, topic.trim());
      onUploaded(result);
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCommitting(false);
    }
  }

  const reviewing = !!preview;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className={cn(
          "flex max-h-[90vh] w-[calc(100vw-1.5rem)] flex-col gap-0 overflow-hidden p-0",
          reviewing ? "sm:!max-w-3xl" : "sm:!max-w-[520px]",
        )}
      >
        <header className="flex shrink-0 items-start justify-between gap-4 border-b px-5 py-4 sm:px-6">
          <div className="min-w-0">
            <DialogTitle className="text-base font-semibold tracking-tight">Add a sample bank</DialogTitle>
            <p className="mt-0.5 text-[12px] text-muted-foreground">
              {reviewing
                ? "Review the parsed questions, then add the bank to your topics."
                : "Upload a Mettl MCQ workbook. We parse the questions so you can review them first."}
            </p>
          </div>
          <DialogClose asChild>
            <Button variant="ghost" size="icon-sm" aria-label="Close">
              <X />
            </Button>
          </DialogClose>
        </header>

        {/* BODY */}
        <div className="scrollbar-thin flex-1 min-h-0 overflow-y-auto px-5 py-6 sm:px-6">
          {!reviewing ? (
            <div className="space-y-5">
              {/* dropzone */}
              <div
                role="button"
                tabIndex={0}
                onClick={() => !parsing && inputRef.current?.click()}
                onKeyDown={(e) => { if ((e.key === "Enter" || e.key === " ") && !parsing) inputRef.current?.click(); }}
                onDragOver={(e) => { e.preventDefault(); if (!parsing) setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragging(false);
                  if (!parsing) pickFile(e.dataTransfer.files?.[0] ?? null);
                }}
                className={cn(
                  "flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-6 py-10 text-center transition-colors",
                  parsing
                    ? "cursor-default border-border bg-muted/30"
                    : dragging
                      ? "cursor-pointer border-primary bg-primary/5"
                      : file
                        ? "cursor-pointer border-emerald-500/40 bg-emerald-500/5"
                        : "cursor-pointer border-border hover:border-muted-foreground/40 hover:bg-muted/30",
                )}
              >
                {parsing ? (
                  <>
                    <Loader2 className="size-7 animate-spin text-muted-foreground" />
                    <span className="flex items-center gap-1.5 text-sm font-medium">
                      <FileSpreadsheet className="size-4" />
                      {file?.name}
                    </span>
                    <span className="text-[11px] text-muted-foreground">Parsing the workbook…</span>
                  </>
                ) : (
                  <>
                    <Upload className="size-7 text-muted-foreground" />
                    <span className="text-sm font-medium">Drop a .xls / .xlsx file here</span>
                    <span className="text-[11px] text-muted-foreground">or click to browse</span>
                  </>
                )}
                <input
                  ref={inputRef}
                  type="file"
                  accept=".xls,.xlsx"
                  className="hidden"
                  onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
                />
              </div>

              {error && (
                <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-[12px] text-destructive">
                  {error}
                </p>
              )}
            </div>
          ) : (
            <div className="space-y-5">
              {/* topic + file + summary */}
              <div className="space-y-2">
                <label className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                  Topic name
                </label>
                <Input
                  value={topic}
                  onChange={(e) => { setTopic(e.target.value); if (error) setError(null); }}
                  onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
                  placeholder="e.g. AWS Networking Basics"
                  className="h-10"
                />
                <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <FileSpreadsheet className="size-3.5 shrink-0" />
                  <span className="truncate">{file?.name}</span>
                </p>
              </div>

              {/* difficulty filter chips */}
              <div className="flex flex-wrap gap-1.5">
                <DifficultyChip
                  label="all"
                  count={preview.total}
                  active={diffFilter === "all"}
                  onClick={() => setDiffFilter("all")}
                />
                {DIFFICULTY_ORDER.map((d) => {
                  const n = preview.by_difficulty[d]?.length ?? 0;
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
                {preview.code_count > 0 && (
                  <span className="ml-auto self-center text-[11px] text-muted-foreground">
                    {preview.code_count} code · {preview.general_count} general
                  </span>
                )}
              </div>

              {/* question list, grouped by difficulty */}
              <div className="space-y-6">
                {DIFFICULTY_ORDER.map((d) => {
                  if (diffFilter !== "all" && diffFilter !== d) return null;
                  const items = preview.by_difficulty[d] ?? [];
                  if (items.length === 0) return null;
                  return (
                    <section key={d} className="space-y-3">
                      <h3 className="font-mono text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                        {d} · {items.length}
                      </h3>
                      <ul className="space-y-3">
                        {items.map((m, i) => (
                          <PreviewMcqRow key={`${d}-${i}`} mcq={m} index={i} />
                        ))}
                      </ul>
                    </section>
                  );
                })}
              </div>

              {error && (
                <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-[12px] text-destructive">
                  {error}
                </p>
              )}
            </div>
          )}
        </div>

        {/* FOOTER */}
        <footer className="flex shrink-0 items-center justify-between gap-2 border-t bg-card/30 px-5 py-3 sm:px-6">
          {reviewing ? (
            <Button variant="ghost" onClick={reset} disabled={committing}>
              <RotateCcw />
              Choose another file
            </Button>
          ) : (
            <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={parsing}>
              Cancel
            </Button>
          )}
          <Button onClick={submit} disabled={!reviewing || committing}>
            {committing
              ? <><Loader2 className="animate-spin" /> Adding…</>
              : <><Plus /> Add the bank{preview ? ` (${preview.total})` : ""}</>}
          </Button>
        </footer>
      </DialogContent>
    </Dialog>
  );
}

function DifficultyChip({
  label, count, active, onClick,
}: { label: string; count: number; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
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

function PreviewMcqRow({ mcq, index }: { mcq: SamplePreviewMCQ; index: number }) {
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
