"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, FileSpreadsheet, Loader2, Upload, X } from "lucide-react";
import {
  Dialog, DialogContent, DialogTitle, DialogClose,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { uploadSample, type UploadSampleResult } from "@/lib/api";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after a successful upload so the catalog can refresh. */
  onUploaded: (result: UploadSampleResult) => void;
}

export function AddSampleModal({ open, onOpenChange, onUploaded }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [topic, setTopic] = useState("");
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setFile(null);
    setTopic("");
    setDragging(false);
    setBusy(false);
    setError(null);
  }, [open]);

  function pickFile(f: File | null) {
    setError(null);
    if (!f) return;
    if (!/\.xlsx?$/i.test(f.name)) {
      setError("Please choose a .xls or .xlsx workbook.");
      return;
    }
    setFile(f);
    // Pre-fill topic from filename if empty.
    if (!topic.trim()) {
      setTopic(f.name.replace(/\.xlsx?$/i, "").replace(/[-_]+/g, " ").trim());
    }
  }

  async function submit() {
    if (!file) { setError("Choose a workbook to upload."); return; }
    if (!topic.trim()) { setError("Give this sample set a topic name."); return; }
    setBusy(true);
    setError(null);
    try {
      const result = await uploadSample(file, topic.trim());
      onUploaded(result);
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="flex w-[calc(100vw-1.5rem)] flex-col gap-0 overflow-hidden p-0 sm:!max-w-[520px]"
      >
        <header className="flex items-start justify-between gap-4 border-b px-5 py-4 sm:px-6">
          <div>
            <DialogTitle className="text-base font-semibold tracking-tight">Add samples</DialogTitle>
            <p className="mt-0.5 text-[12px] text-muted-foreground">
              Upload a Mettl bulk-upload workbook. We parse the questions and add it to your topics.
            </p>
          </div>
          <DialogClose asChild>
            <Button variant="ghost" size="icon-sm" aria-label="Close">
              <X />
            </Button>
          </DialogClose>
        </header>

        <div className="space-y-5 px-5 py-6 sm:px-6">
          {/* dropzone */}
          <div
            role="button"
            tabIndex={0}
            onClick={() => inputRef.current?.click()}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") inputRef.current?.click(); }}
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              pickFile(e.dataTransfer.files?.[0] ?? null);
            }}
            className={cn(
              "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-6 py-8 text-center transition-colors",
              dragging
                ? "border-primary bg-primary/5"
                : file
                  ? "border-emerald-500/40 bg-emerald-500/5"
                  : "border-border hover:border-muted-foreground/40 hover:bg-muted/30",
            )}
          >
            {file ? (
              <>
                <CheckCircle2 className="size-7 text-emerald-600 dark:text-emerald-400" />
                <span className="flex items-center gap-1.5 text-sm font-medium">
                  <FileSpreadsheet className="size-4" />
                  {file.name}
                </span>
                <span className="text-[11px] text-muted-foreground">
                  {(file.size / 1024).toFixed(0)} KB · click to choose a different file
                </span>
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

          {/* topic name */}
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
            <p className="text-[10px] text-muted-foreground">
              This is the name shown in the topics list and used when generating questions.
            </p>
          </div>

          {error && (
            <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-[12px] text-destructive">
              {error}
            </p>
          )}
        </div>

        <footer className="flex items-center justify-end gap-2 border-t bg-card/30 px-5 py-3 sm:px-6">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button onClick={submit} disabled={busy || !file}>
            {busy ? <><Loader2 className="animate-spin" /> Analyzing…</> : <><Upload /> Add samples</>}
          </Button>
        </footer>
      </DialogContent>
    </Dialog>
  );
}
