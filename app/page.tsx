"use client";

import { useState, useRef, useEffect } from "react";
import { Cpu } from "lucide-react";
import { SamplesList } from "@/components/SamplesList";
import { ConfigDialog } from "@/components/ConfigDialog";
import { RunView } from "@/components/RunView";
import { TopicModal } from "@/components/TopicModal";
import { startGeneration, fetchFinal } from "@/lib/api";
import type { GenerateRequest, MCQ, StreamEvent } from "@/lib/types";

export default function Page() {
  const [sampleFile, setSampleFile] = useState<string>("");
  const [previewFile, setPreviewFile] = useState<string>("");
  const [configOpen, setConfigOpen] = useState(false);
  const [config, setConfig] = useState<GenerateRequest | null>(null);

  const [events, setEvents] = useState<StreamEvent[]>([]);
  const [results, setResults] = useState<MCQ[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancelRef = useRef<(() => void) | null>(null);

  useEffect(() => () => { cancelRef.current?.(); }, []);

  function pickSample(filename: string) {
    setSampleFile(filename);
    setConfigOpen(true);
  }

  async function start(req: GenerateRequest) {
    setConfigOpen(false);
    setConfig(req);
    setEvents([]);
    setResults([]);
    setError(null);
    setRunning(true);

    cancelRef.current = startGeneration(
      req,
      (evt) => {
        setEvents((prev) => [...prev, evt]);

        if (evt.type === "workflow_done") {
          const qs = evt.data?.questions;
          if (Array.isArray(qs) && qs.length > 0) {
            setResults(qs as MCQ[]);
          } else if (evt.data?.run_id) {
            fetchFinal(evt.data.run_id)
              .then((d) => { if (d.questions) setResults(d.questions as MCQ[]); })
              .catch(() => {});
          }
          return;
        }

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
      (e) => { setError(e.message); setRunning(false); },
    );
  }

  function reset() {
    cancelRef.current?.();
    setConfig(null);
    setEvents([]);
    setResults([]);
    setError(null);
    setSampleFile("");
  }

  const inRun = config !== null && (running || results.length > 0 || error !== null);

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
            <SamplesList
              selected={sampleFile}
              onSelect={pickSample}
              onPreview={setPreviewFile}
            />
          </main>
          <ConfigDialog
            open={configOpen}
            onOpenChange={setConfigOpen}
            sampleFiles={sampleFile ? [sampleFile] : []}
            onStart={start}
            onPreview={setPreviewFile}
          />
          <TopicModal filename={previewFile} onClose={() => setPreviewFile("")} />
        </>
      )}
    </div>
  );
}
