"use client";

import { useEffect, useRef } from "react";
import {
  Activity, AlertTriangle, CheckCircle2, RefreshCcw, Search, Terminal,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { StreamEvent } from "@/lib/types";

interface Props {
  events: StreamEvent[];
  running: boolean;
}

const ICONS: Record<string, any> = {
  workflow_start: Activity,
  phase: Activity,
  generated: CheckCircle2,
  question_start: Activity,
  plag_check: Search,
  plag_unique: CheckCircle2,
  plag_flagged: AlertTriangle,
  plag_gave_up: AlertTriangle,
  revamping: RefreshCcw,
  code_verify: Terminal,
  code_verified: CheckCircle2,
  question_done: CheckCircle2,
  workflow_done: CheckCircle2,
  warn: AlertTriangle,
  error: AlertTriangle,
};

type Tone = "muted" | "success" | "warning" | "destructive" | "info";
const TONES: Record<string, Tone> = {
  workflow_done: "success",
  generated: "success",
  plag_unique: "success",
  code_verified: "success",
  question_done: "success",
  plag_flagged: "warning",
  plag_gave_up: "destructive",
  revamping: "info",
  code_verify: "info",
  plag_check: "info",
  warn: "warning",
  error: "destructive",
};

function describe(e: StreamEvent): string {
  const d = e.data || {};
  switch (e.type) {
    case "workflow_start":
      return `Starting — ${d.count} × ${d.difficulty} ${d.mcq_type} on "${d.topic}"`;
    case "phase": return d.message || `Phase: ${d.phase}`;
    case "generated": return `Generated ${d.count} draft questions`;
    case "question_start": return `Q${d.index + 1}: ${(d.question?.question || "").slice(0, 90)}…`;
    case "plag_check": return `Q${d.index + 1}: plagiarism check (attempt ${d.attempt})`;
    case "plag_unique": return `Q${d.index + 1}: unique ✓ (attempt ${d.attempt})`;
    case "plag_flagged": return `Q${d.index + 1}: flagged — ${(d.matches || []).length} match(es)`;
    case "plag_gave_up": return `Q${d.index + 1}: max attempts reached`;
    case "revamping": return `Q${d.index + 1}: revamping (attempt ${d.attempt})`;
    case "code_verify": return `Q${d.index + 1}: compiling ${d.language}`;
    case "code_verified": return `Q${d.index + 1}: code verified — ${d.info?.fix || "ok"}`;
    case "question_done": return `Q${d.index + 1}: done`;
    case "workflow_done": return `Workflow done — ${d.count} questions`;
    case "warn": return `⚠ ${d.message}`;
    case "error": return `✗ ${d.message}`;
    default: return e.type;
  }
}

function dotClass(tone: Tone) {
  switch (tone) {
    case "success": return "bg-emerald-500";
    case "warning": return "bg-amber-500";
    case "destructive": return "bg-destructive";
    case "info": return "bg-primary/60";
    default: return "bg-muted-foreground/40";
  }
}

export function Timeline({ events }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    ref.current.scrollTop = ref.current.scrollHeight;
  }, [events]);

  return (
    <div ref={ref} className="scrollbar-thin flex-1 min-h-0 overflow-y-auto px-6 py-4">
      {events.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">No events yet.</p>
      ) : (
        <ol className="relative space-y-3 border-l border-border pl-5">
          {events.map((e, i) => {
            const Icon = ICONS[e.type] || Activity;
            const tone = TONES[e.type] || "muted";
            return (
              <li key={i} className="relative">
                <span
                  className={cn(
                    "absolute -left-[1.45rem] top-1.5 size-3 rounded-full ring-4 ring-background",
                    dotClass(tone),
                  )}
                />
                <div className="flex items-start gap-2">
                  <Icon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1 space-y-1">
                    <Badge variant="outline" className="text-[10px]">
                      {e.type}
                    </Badge>
                    <p className="break-words font-mono text-[11px] leading-relaxed text-foreground/80">
                      {describe(e)}
                    </p>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
