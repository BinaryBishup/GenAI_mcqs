"use client";

import { Download, FileJson, FileSpreadsheet, FileUp, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { downloadMCQs, flaggedCount, type DownloadFormat } from "@/lib/download";
import type { MCQ } from "@/lib/types";

const FORMATS: { fmt: DownloadFormat; label: string; icon: React.ReactNode }[] = [
  { fmt: "json", label: "JSON", icon: <FileJson /> },
  { fmt: "csv", label: "CSV", icon: <FileSpreadsheet /> },
  { fmt: "mettl", label: "Mettl bulk-upload (.xls)", icon: <FileUp /> },
];

/**
 * Download dropdown shared by the live run view and the Generations detail.
 * Default exports only quality-passed questions; flagged items (plagiarism,
 * failed code-verify, answer-check disagreement) are offered separately under
 * an explicit "include flagged" group so they're never shipped by accident.
 */
export function DownloadMenu({
  mcqs, topic, busy, variant = "default", className,
}: {
  mcqs: MCQ[];
  topic: string;
  busy?: boolean;
  variant?: "default" | "onDark";
  className?: string;
}) {
  const total = mcqs.length;
  const flagged = flaggedCount(mcqs);
  const usable = total - flagged;

  const triggerClass = variant === "onDark"
    ? "border-white/25 bg-white/5 text-white hover:bg-white/15 hover:text-white aria-expanded:bg-white/15 disabled:text-white/40"
    : "";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          disabled={total === 0 || busy}
          className={className ?? triggerClass}
        >
          {busy ? <Loader2 className="animate-spin" /> : <Download />}
          Download
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="text-[11px] font-normal text-muted-foreground">
          {flagged > 0
            ? `${usable} ready · ${flagged} flagged (excluded)`
            : `${usable} ready`}
        </DropdownMenuLabel>
        {FORMATS.map(({ fmt, label, icon }) => (
          <DropdownMenuItem key={fmt} onClick={() => downloadMCQs(mcqs, fmt, topic)}>
            {icon}
            {label}
          </DropdownMenuItem>
        ))}
        {flagged > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-[11px] font-normal text-amber-600 dark:text-amber-400">
              Include {flagged} flagged item{flagged === 1 ? "" : "s"}
            </DropdownMenuLabel>
            {FORMATS.map(({ fmt, label, icon }) => (
              <DropdownMenuItem
                key={`all-${fmt}`}
                onClick={() => downloadMCQs(mcqs, fmt, topic, { includeFlagged: true })}
              >
                {icon}
                {label} · all
              </DropdownMenuItem>
            ))}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
