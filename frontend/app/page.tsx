"use client";

import { useState } from "react";
import { Cpu } from "lucide-react";
import { SamplesList } from "@/components/SamplesList";
import { ConfigDialog } from "@/components/ConfigDialog";
import { RunView } from "@/components/RunView";
import { startGeneration, subscribe } from "@/lib/api";
import type { GenerateRequest, MCQ, StreamEvent } from "@/lib/types";

export default function Page() {
  const [sampleFile, setSampleFile] = useState<string>("");
  const [configOpen, setConfigOpen] = useState(false);
  const [config, setConfig] = useState<GenerateRequest | null>(null);

  function pickSample(filename: string) {
    setSampleFile(filename);
    setConfigOpen(true);
  }

  const [events, setEvents] = useState<StreamEvent[]>([]);
  const [results, setResults] = useState<MCQ[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start(req: GenerateRequest) {
    setConfigOpen(false);
    setConfig(req);
    setEvents([]);
    setResults([]);
    setError(null);
    setRunning(true);
    try {
      const { session_id } = await startGeneration(req);
      subscribe(
        session_id,
        (evt) => {
          setEvents((prev) => [...prev, evt]);

          // workflow_done carries the final, authoritative list — replace.
          // Guard against the orchestrator occasionally shipping a non-array
          // (e.g. just the count) for `questions`; fetch /api/runs/{id}/final
          // as a fallback so the user always sees their MCQs.
          if (evt.type === "workflow_done") {
            const qs = evt.data?.questions;
            if (Array.isArray(qs) && qs.length > 0) {
              setResults(qs as MCQ[]);
            } else if (evt.data?.run_id) {
              const backend = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";
              fetch(`${backend}/api/runs/${evt.data.run_id}/final`)
                .then((r) => r.ok ? r.json() : null)
                .then((d) => { if (d?.questions) setResults(d.questions as MCQ[]); })
                .catch(() => {});
            }
            return;
          }

          // question_start / question_done both ship the MCQ payload. Merge
          // into the existing slot so a slim later event doesn't wipe fields
          // that an earlier full event provided (e.g. options array).
          const isQuestionEvt =
            (evt.type === "question_start" || evt.type === "question_done") &&
            evt.data?.question;
          if (isQuestionEvt) {
            setResults((prev) => {
              const next = [...prev];
              const idx = evt.data.index ?? next.length;
              const incoming = evt.data.question as Partial<MCQ>;
              next[idx] = { ...(next[idx] ?? {}), ...incoming } as MCQ;
              return next;
            });
          }
        },
        () => setRunning(false),
        () => { setError("connection lost — see backend logs"); setRunning(false); },
      );
    } catch (e: any) {
      setError(e?.message ?? String(e));
      setRunning(false);
    }
  }

  function reset() {
    setConfig(null);
    setEvents([]);
    setResults([]);
    setError(null);
    setSampleFile("");
  }

  const inRun = config !== null && (running || results.length > 0);

  return (
    <div className="flex h-screen flex-col">
      {inRun && config ? (
        <RunView
          config={config}
          events={events}
          results={results}
          running={running}
          error={error}
          onReset={reset}
        />
      ) : (
        <>
          <header className="shrink-0 border-b border-blue-950/50 bg-blue-950 text-white">
            <div className="mx-auto flex h-14 max-w-[1400px] items-center px-6">
              <div className="flex items-center gap-2.5">
                <div className="grid size-8 place-items-center rounded-md bg-white/10 text-white ring-1 ring-white/20">
                  <Cpu className="size-4" />
                </div>
                <h1 className="text-sm font-semibold text-white">MCQ Workflow</h1>
              </div>
            </div>
          </header>
          <main className="flex-1 min-h-0">
            <SamplesList selected={sampleFile} onSelect={pickSample} />
          </main>
          <ConfigDialog
            open={configOpen}
            onOpenChange={setConfigOpen}
            sampleFiles={sampleFile ? [sampleFile] : []}
            onStart={start}
          />
        </>
      )}
    </div>
  );
}
