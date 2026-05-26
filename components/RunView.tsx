"use client";

import {
  ArrowLeft, Download, FileJson, FileSpreadsheet, FileUp, Loader2, Sparkles, Activity,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Timeline } from "@/components/Timeline";
import { MCQCard } from "@/components/MCQCard";
import { downloadMCQs } from "@/lib/download";
import type { GenerateRequest, MCQ, StreamEvent } from "@/lib/types";

interface Props {
  config: GenerateRequest;
  events: StreamEvent[];
  results: MCQ[];
  running: boolean;
  error: string | null;
  onReset: () => void;
}

export function RunView({ config, events, results, running, error, onReset }: Props) {
  const cleanResults = results.filter(Boolean);

  return (
    <div className="flex h-full flex-col">
      {/* navy run header */}
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-blue-950/50 bg-blue-950 px-6 py-3 text-white">
        <div className="flex min-w-0 items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={onReset}
            disabled={running}
            className="text-white/90 hover:bg-white/10 hover:text-white aria-expanded:bg-white/10 disabled:text-white/50"
          >
            <ArrowLeft />
            Back
          </Button>
          <div className="h-6 w-px bg-white/15" />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-white">{config.topic}</p>
            <p className="mt-0.5 truncate text-[11px] text-white/60">
              {config.count} × {config.difficulty} {config.mcq_type} ·
              {" "}{config.sample_files.length} sample file{config.sample_files.length === 1 ? "" : "s"} ·
              {" "}{config.quality}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {running ? (
            <Badge
              variant="outline"
              className="gap-1.5 border-white/20 bg-white/5 normal-case tracking-normal text-white"
            >
              <Loader2 className="size-3 animate-spin" />
              Running
            </Badge>
          ) : (
            <Badge className="gap-1.5 bg-emerald-500/20 normal-case tracking-normal text-emerald-100 hover:bg-emerald-500/20">
              <Sparkles className="size-3" />
              {cleanResults.length} ready
            </Badge>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                disabled={cleanResults.length === 0}
                className="border-white/25 bg-white/5 text-white hover:bg-white/15 hover:text-white aria-expanded:bg-white/15 disabled:text-white/40"
              >
                <Download />
                Download
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => downloadMCQs(cleanResults, "json", config.topic)}>
                <FileJson />
                JSON
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => downloadMCQs(cleanResults, "csv", config.topic)}>
                <FileSpreadsheet />
                CSV
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => downloadMCQs(cleanResults, "mettl", config.topic)}>
                <FileUp />
                Mettl bulk-upload (.xls)
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {error && (
        <div className="shrink-0 border-b border-destructive/40 bg-destructive/10 px-6 py-3 text-sm text-destructive">
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-widest">
            Generation failed
          </p>
          <p className="whitespace-pre-wrap break-words font-mono text-[12px] leading-relaxed">
            {error}
          </p>
          <p className="mt-2 text-[11px] text-destructive/80">
            Click <span className="font-medium">Back</span> to return to the samples list and try again.
          </p>
        </div>
      )}

      {/* two-column body, true full height */}
      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_400px]">
        {/* MCQ Outputs (left) */}
        <section className="flex min-h-0 flex-col lg:border-r">
          <div className="flex shrink-0 items-center justify-between border-b px-6 py-3">
            <div className="flex items-center gap-2">
              <Sparkles className="size-4 text-muted-foreground" />
              <h2 className="text-[11px] font-semibold uppercase tracking-widest">MCQ Outputs</h2>
            </div>
            <Badge variant="outline">{cleanResults.length} / {config.count}</Badge>
          </div>
          <div className="scrollbar-thin flex-1 min-h-0 overflow-y-auto">
            <div className="space-y-4 px-6 py-5">
              {cleanResults.length === 0 ? (
                <p className="py-16 text-center text-sm text-muted-foreground">
                  {running
                    ? "Generating… questions will appear here as they finish."
                    : "No results yet."}
                </p>
              ) : (
                cleanResults.map((q, i) => <MCQCard key={q.id || i} mcq={q} index={i} />)
              )}
            </div>
          </div>
        </section>

        {/* Timeline (right) */}
        <aside className="flex min-h-0 flex-col border-t lg:border-l-0 lg:border-t-0">
          <div className="flex shrink-0 items-center justify-between border-b px-6 py-3">
            <div className="flex items-center gap-2">
              {running ? (
                <Loader2 className="size-4 animate-spin text-muted-foreground" />
              ) : (
                <Activity className="size-4 text-muted-foreground" />
              )}
              <h2 className="text-[11px] font-semibold uppercase tracking-widest">Timeline</h2>
            </div>
            <Badge variant="outline">{events.length}</Badge>
          </div>
          <Timeline events={events} running={running} />
        </aside>
      </div>
    </div>
  );
}
