"use client";

import { useState, useRef, useEffect } from "react";
import { SamplesList } from "@/components/SamplesList";
import { ConfigDialog } from "@/components/ConfigDialog";
import { RunView } from "@/components/RunView";
import { TopicModal } from "@/components/TopicModal";
import { AppNav } from "@/components/AppNav";
import { startGeneration, fetchFinal } from "@/lib/api";
import type { GenerateRequest, MCQ, StreamEvent } from "@/lib/types";

export default function SamplesPage() {
  const [sampleFiles, setSampleFiles] = useState<string[]>([]);
  const [previewFile, setPreviewFile] = useState<string>("");
  const [configOpen, setConfigOpen] = useState(false);
  const [config, setConfig] = useState<GenerateRequest | null>(null);

  const [events, setEvents] = useState<StreamEvent[]>([]);
  const [results, setResults] = useState<MCQ[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const cancelRef = useRef<(() => void) | null>(null);

  useEffect(() => () => { cancelRef.current?.(); }, []);

  function pickSampleForCreate(filenames: string[]) {
    if (filenames.length === 0) return;
    setSampleFiles(filenames);
    setConfigOpen(true);
  }

  async function start(req: GenerateRequest) {
    setConfigOpen(false);
    setConfig(req);
    setEvents([]);
    setResults([]);
    setError(null);
    setRunId(null);
    setRunning(true);

    cancelRef.current = startGeneration(
      req,
      (evt) => {
        setEvents((prev) => [...prev, evt]);

        if ((evt.type === "workflow_start" || evt.type === "workflow_done") && evt.data?.run_id) {
          setRunId(evt.data.run_id as string);
        }

        if (evt.type === "error") {
          const msg = evt.data?.message
            ? `${evt.data.phase ? `[${evt.data.phase}] ` : ""}${evt.data.message}`
            : "Generation failed (no message).";
          setError(msg);
          return;
        }

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
    setRunId(null);
    setSampleFiles([]);
  }

  // Once a run has been kicked off, we stay on RunView until the user clicks
  // Back. Without this, a workflow that ends in an error (and produced no
  // results) silently flips us back to the list, hiding the error.
  const inRun = config !== null;

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
          runId={runId}
          onChangeMcq={(i, m) => setResults((prev) => { const n = [...prev]; n[i] = m; return n; })}
        />
      ) : (
        <>
          <AppNav />
          <main className="flex-1 min-h-0">
            <SamplesList
              onCreate={pickSampleForCreate}
              onPreview={setPreviewFile}
            />
          </main>
          <ConfigDialog
            open={configOpen}
            onOpenChange={setConfigOpen}
            sampleFiles={sampleFiles}
            onStart={start}
            onPreview={setPreviewFile}
          />
          <TopicModal filename={previewFile} onClose={() => setPreviewFile("")} />
        </>
      )}
    </div>
  );
}
