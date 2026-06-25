"use client";

import { useState } from "react";
import { AlertTriangle, Check, Loader2, Pencil, Sparkles, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { cn, isUsable, exclusionReason } from "@/lib/utils";
import { updateMcq, aiModifyMcq } from "@/lib/api";
import type { Language, MCQ } from "@/lib/types";

interface Props {
  mcq: MCQ;
  index: number;
  /** Run id — enables persistence + answer-recheck on edit. */
  runId?: string | null;
  /** When provided, the card becomes editable (manual + AI). Receives the updated MCQ. */
  onChange?: (mcq: MCQ) => void;
}

export function MCQCard({ mcq, index, runId, onChange }: Props) {
  const [mode, setMode] = useState<"view" | "edit" | "ai">("view");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const editable = !!onChange;
  const options = mcq.options ?? [];
  const correctIndex = mcq.correct_index ?? -1;
  const plagVariant =
    mcq.plag_status === "unique" ? "secondary" :
    mcq.plag_status === "revamped" ? "outline" :
    mcq.plag_status === "flagged" ? "destructive" : "outline";
  const excluded = !isUsable(mcq);
  const reason = exclusionReason(mcq);
  const checkLetter =
    mcq.answer_check_index != null && mcq.answer_check_index >= 0
      ? String.fromCharCode(65 + mcq.answer_check_index)
      : null;

  async function persist(next: MCQ) {
    setErr(null);
    setBusy(true);
    try {
      const saved = runId ? await updateMcq(runId, index, next) : next;
      onChange?.(saved);
      setMode("view");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function runAi(instruction: string) {
    setErr(null);
    setBusy(true);
    try {
      const modified = await aiModifyMcq(mcq, instruction);
      const saved = runId ? await updateMcq(runId, index, modified) : modified;
      onChange?.(saved);
      setMode("view");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className={cn("overflow-hidden", excluded && "border-amber-500/50")}>
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
            {mcq.answer_check_status === "agree" && (
              <Badge className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">answer ✓</Badge>
            )}
            {mcq.answer_check_status === "disagree" && (
              <Badge variant="destructive" title={mcq.answer_check_notes ?? undefined}>
                answer key suspect{checkLetter ? ` · checker: ${checkLetter}` : ""}
              </Badge>
            )}
            {mcq.answer_check_status === "uncertain" && (
              <Badge className="bg-amber-500/10 text-amber-600 dark:text-amber-400" title={mcq.answer_check_notes ?? undefined}>
                answer unverified
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            {editable && mode === "view" && (
              <>
                <Button variant="ghost" size="xs" onClick={() => { setErr(null); setMode("edit"); }}>
                  <Pencil /> Edit
                </Button>
                <Button variant="ghost" size="xs" onClick={() => { setErr(null); setMode("ai"); }}>
                  <Sparkles /> Ask AI
                </Button>
              </>
            )}
            <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              {mcq.id}
            </span>
          </div>
        </div>
        {excluded && reason && mode === "view" && (
          <p className="flex items-center gap-1.5 text-[11px] font-medium text-amber-600 dark:text-amber-400">
            <AlertTriangle className="size-3 shrink-0" />
            Excluded from default export — {reason}.
          </p>
        )}
        {err && (
          <p className="flex items-center gap-1.5 text-[11px] font-medium text-destructive">
            <AlertTriangle className="size-3 shrink-0" /> {err}
          </p>
        )}
      </CardHeader>

      {mode === "edit" ? (
        <EditForm mcq={mcq} busy={busy} onCancel={() => setMode("view")} onSave={persist} />
      ) : (
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
                      correct ? "border-emerald-500 bg-emerald-500 text-white" : "border-border text-muted-foreground",
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
              <summary className="cursor-pointer text-muted-foreground hover:text-foreground">compiler output</summary>
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

          {mode === "ai" && (
            <AiPanel busy={busy} onCancel={() => setMode("view")} onSubmit={runAi} />
          )}
        </CardContent>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
function EditForm({
  mcq, busy, onCancel, onSave,
}: {
  mcq: MCQ;
  busy: boolean;
  onCancel: () => void;
  onSave: (next: MCQ) => void;
}) {
  const [question, setQuestion] = useState(mcq.question);
  const [options, setOptions] = useState<string[]>(() => {
    const o = [...(mcq.options ?? [])];
    while (o.length < 4) o.push("");
    return o.slice(0, 4);
  });
  const [correct, setCorrect] = useState(mcq.correct_index ?? 0);
  const [explanation, setExplanation] = useState(mcq.explanation ?? "");
  const [code, setCode] = useState(mcq.snippet?.code ?? "");
  const [lang, setLang] = useState<Language>((mcq.snippet?.language ?? "python") as Language);

  function save() {
    const next: MCQ = {
      ...mcq,
      question,
      options: options.map((o) => o),
      correct_index: Math.max(0, Math.min(3, correct)),
      explanation: explanation.trim() || null,
      snippet: code.trim() ? { language: lang, code } : null,
    };
    onSave(next);
  }

  return (
    <CardContent className="space-y-4 pt-5">
      <Labeled label="Question">
        <textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          className="scrollbar-thin min-h-20 w-full resize-y rounded-md border bg-card px-3 py-2 text-sm leading-relaxed outline-none focus:ring-2 focus:ring-ring/30"
        />
      </Labeled>

      <Labeled label="Code snippet (optional)">
        <div className="flex items-center gap-2">
          <select
            value={lang}
            onChange={(e) => setLang(e.target.value as Language)}
            className="h-8 rounded-md border bg-card px-2 text-xs outline-none focus:ring-2 focus:ring-ring/30"
          >
            {(["python", "java", "csharp", "cpp", "c", "javascript", "html", "css"] as Language[]).map((l) => (
              <option key={l} value={l}>{l}</option>
            ))}
          </select>
          <span className="text-[10px] text-muted-foreground">leave code blank to remove the snippet</span>
        </div>
        <textarea
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="// optional code listing"
          className="scrollbar-thin mt-1.5 min-h-16 w-full resize-y rounded-md border bg-muted/40 px-3 py-2 font-mono text-xs leading-relaxed outline-none focus:ring-2 focus:ring-ring/30"
        />
      </Labeled>

      <Labeled label="Options (select the correct one)">
        <ul className="space-y-1.5">
          {options.map((opt, i) => (
            <li key={i} className="flex items-start gap-2">
              <button
                type="button"
                onClick={() => setCorrect(i)}
                aria-label={`Mark option ${String.fromCharCode(65 + i)} correct`}
                className={cn(
                  "mt-1 grid size-5 shrink-0 place-items-center rounded-full border text-[10px] font-semibold transition-colors",
                  i === correct ? "border-emerald-500 bg-emerald-500 text-white" : "border-border text-muted-foreground hover:border-emerald-500/60",
                )}
              >
                {String.fromCharCode(65 + i)}
              </button>
              <textarea
                value={opt}
                onChange={(e) => setOptions((prev) => prev.map((o, j) => (j === i ? e.target.value : o)))}
                rows={1}
                className="scrollbar-thin min-h-9 w-full resize-y rounded-md border bg-card px-3 py-1.5 font-mono text-[13px] leading-relaxed outline-none focus:ring-2 focus:ring-ring/30"
              />
            </li>
          ))}
        </ul>
      </Labeled>

      <Labeled label="Explanation">
        <textarea
          value={explanation}
          onChange={(e) => setExplanation(e.target.value)}
          className="scrollbar-thin min-h-16 w-full resize-y rounded-md border bg-card px-3 py-2 text-sm leading-relaxed outline-none focus:ring-2 focus:ring-ring/30"
        />
      </Labeled>

      <div className="flex items-center justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={busy}>Cancel</Button>
        <Button size="sm" onClick={save} disabled={busy}>
          {busy ? <Loader2 className="animate-spin" /> : <Check />}
          Save{busy ? " & re-checking…" : ""}
        </Button>
      </div>
    </CardContent>
  );
}

function AiPanel({
  busy, onCancel, onSubmit,
}: {
  busy: boolean;
  onCancel: () => void;
  onSubmit: (instruction: string) => void;
}) {
  const [text, setText] = useState("");
  return (
    <div className="space-y-2 rounded-md border border-primary/30 bg-primary/5 p-3">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-widest text-primary">
        <Sparkles className="size-3.5" /> Ask AI to modify this question
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        autoFocus
        placeholder={"e.g. make the distractors harder · rewrite the scenario for healthcare · shorten option C · fix the explanation"}
        className="scrollbar-thin min-h-16 w-full resize-y rounded-md border bg-card px-3 py-2 text-sm leading-relaxed outline-none focus:ring-2 focus:ring-ring/30"
      />
      <div className="flex items-center justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={busy}>
          <X /> Cancel
        </Button>
        <Button size="sm" onClick={() => text.trim() && onSubmit(text.trim())} disabled={busy || !text.trim()}>
          {busy ? <Loader2 className="animate-spin" /> : <Sparkles />}
          {busy ? "Applying…" : "Apply change"}
        </Button>
      </div>
    </div>
  );
}

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}
