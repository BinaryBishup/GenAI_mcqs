"use client";

import { Check } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { MCQ } from "@/lib/types";

interface Props { mcq: MCQ; index: number; }

export function MCQCard({ mcq, index }: Props) {
  // Tolerate partial payloads — some orchestrator events ship a slim object.
  const options = mcq.options ?? [];
  const correctIndex = mcq.correct_index ?? -1;
  const plagVariant =
    mcq.plag_status === "unique" ? "secondary" :
    mcq.plag_status === "revamped" ? "outline" :
    mcq.plag_status === "flagged" ? "destructive" : "outline";

  return (
    <Card className="overflow-hidden">
      <CardHeader className="space-y-2 border-b pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant="outline" className="font-mono">Q{index + 1}</Badge>
            <Badge variant="secondary">{mcq.type}</Badge>
            <Badge variant="outline">{mcq.difficulty}</Badge>
            {mcq.plag_status && (
              <Badge variant={plagVariant as any}>
                {mcq.plag_status}{mcq.plag_attempts ? ` ·${mcq.plag_attempts}` : ""}
              </Badge>
            )}
            {mcq.code_verified === true && (
              <Badge className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">verified</Badge>
            )}
            {mcq.code_verified === false && <Badge variant="destructive">verify failed</Badge>}
          </div>
          <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            {mcq.id}
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 pt-5">
        <p className="text-sm leading-relaxed whitespace-pre-wrap">{mcq.question}</p>

        {mcq.snippet?.code?.trim() && (
          <pre className="scrollbar-thin overflow-x-auto rounded-md border bg-muted/40 p-3 text-xs leading-relaxed">
            <code className="font-mono">{mcq.snippet.code}</code>
          </pre>
        )}

        <ul className="space-y-1.5">
          {options.map((opt, i) => {
            const correct = i === correctIndex;
            const letter = String.fromCharCode(65 + i);
            return (
              <li
                key={i}
                className={cn(
                  "flex items-center gap-2.5 rounded-md border px-3 py-2 text-sm transition-colors",
                  correct
                    ? "border-emerald-500/40 bg-emerald-500/5 text-foreground"
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
                <span className="min-w-0 flex-1 break-words font-mono">{opt}</span>
                {correct && (
                  <Check className="size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-label="correct" />
                )}
              </li>
            );
          })}
        </ul>

        {mcq.explanation && (
          <p className="rounded-md border bg-muted/30 p-3 text-xs leading-relaxed text-muted-foreground">
            <span className="font-semibold text-foreground">Explanation: </span>
            {mcq.explanation}
          </p>
        )}

        {mcq.code_actual_output && (
          <details className="text-xs">
            <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
              compiler output
            </summary>
            <pre className="scrollbar-thin mt-2 overflow-x-auto rounded-md border bg-muted/30 p-3">
              <code className="font-mono whitespace-pre">{mcq.code_actual_output}</code>
            </pre>
          </details>
        )}

        {mcq.plag_matches && mcq.plag_matches.length > 0 && (
          <details className="text-xs">
            <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
              {mcq.plag_matches.length} prior match URL(s)
            </summary>
            <ul className="mt-2 space-y-1 pl-4">
              {mcq.plag_matches.map((u, i) => (
                <li key={i} className="break-all text-muted-foreground">{u}</li>
              ))}
            </ul>
          </details>
        )}
      </CardContent>
    </Card>
  );
}
