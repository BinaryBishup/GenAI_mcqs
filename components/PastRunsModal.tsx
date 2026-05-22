"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronRight, Loader2 } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { fetchPastRuns } from "@/lib/api";
import type { PastRunSummary } from "@/lib/types";

interface Props {
  /** Empty string = closed. Otherwise filter past runs by this sample file. */
  filename: string;
  onClose: () => void;
  /** Called when user picks a past run to view. */
  onPickRun: (run: PastRunSummary) => void;
}

export function PastRunsModal({ filename, onClose, onPickRun }: Props) {
  const open = !!filename;
  const [runs, setRuns] = useState<PastRunSummary[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!filename) {
      setRuns(null);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    fetchPastRuns(filename)
      .then((d) => setRuns(d.runs))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [filename]);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent
        showCloseButton={true}
        className="flex max-h-[80vh] flex-col gap-0 overflow-hidden p-0 sm:!max-w-2xl"
      >
        <DialogHeader className="shrink-0 space-y-1 border-b px-6 py-4">
          <DialogTitle className="font-mono text-sm uppercase tracking-wider">
            Past runs
          </DialogTitle>
          <DialogDescription>
            {filename ? <span className="font-mono">{filename}</span> : "—"}
          </DialogDescription>
        </DialogHeader>

        <div className="scrollbar-thin flex-1 min-h-0 overflow-y-auto px-6 py-4">
          {loading && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Loading runs…
            </p>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
          {runs && !loading && runs.length === 0 && (
            <p className="py-10 text-center text-sm text-muted-foreground">
              No previous runs for this topic yet.
            </p>
          )}
          {runs && runs.length > 0 && (
            <ul className="space-y-2">
              {runs.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => onPickRun(r)}
                    disabled={r.status !== "done"}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-md border bg-card px-4 py-3 text-left transition-colors",
                      r.status === "done"
                        ? "hover:border-primary/40 hover:bg-muted/50"
                        : "opacity-60",
                    )}
                  >
                    <RunStatusIcon status={r.status} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{r.topic}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        <Badge variant="outline" className="font-mono text-[10px]">
                          {r.count} × {r.difficulty}
                        </Badge>
                        <Badge variant="secondary" className="font-mono text-[10px]">
                          {r.mcq_type}
                        </Badge>
                        <Badge variant="outline" className="font-mono text-[10px]">
                          {r.quality}
                        </Badge>
                        <span className="text-[10px] text-muted-foreground">
                          {formatRelative(r.started_at)}
                        </span>
                      </div>
                      {r.error_message && (
                        <p className="mt-1 truncate text-[11px] text-destructive">{r.error_message}</p>
                      )}
                    </div>
                    {r.status === "done" && (
                      <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function RunStatusIcon({ status }: { status: PastRunSummary["status"] }) {
  if (status === "done") return <CheckCircle2 className="size-5 shrink-0 text-emerald-500" />;
  if (status === "error") return <AlertTriangle className="size-5 shrink-0 text-destructive" />;
  return <Loader2 className="size-5 shrink-0 animate-spin text-muted-foreground" />;
}

function formatRelative(iso: string): string {
  const t = new Date(iso).getTime();
  const diff = Date.now() - t;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}
