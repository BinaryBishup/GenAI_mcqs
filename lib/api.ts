import type {
  GenerateRequest, MCQ, PastRunSummary, SampleCatalog, SampleTopic, StreamEvent,
} from "./types";

export async function fetchCatalog(): Promise<SampleCatalog> {
  const res = await fetch("/api/samples");
  if (!res.ok) throw new Error(`catalog failed: ${res.status}`);
  return res.json();
}

export async function fetchTopic(filename: string): Promise<SampleTopic> {
  const res = await fetch(`/api/samples/${encodeURIComponent(filename)}`);
  if (!res.ok) throw new Error(`topic fetch failed: ${res.status}`);
  return res.json();
}

export interface UploadSampleResult {
  ok: true;
  source_file: string;
  topic: string;
  inserted: number;
  code_count: number;
  general_count: number;
}

export async function uploadSample(file: File, topic: string): Promise<UploadSampleResult> {
  const form = new FormData();
  form.append("file", file);
  form.append("topic", topic);
  const res = await fetch("/api/samples/upload", { method: "POST", body: form });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error ?? `upload failed: ${res.status}`);
  return data as UploadSampleResult;
}

export async function fetchPastRuns(source?: string): Promise<{ count: number; runs: PastRunSummary[] }> {
  const url = source ? `/api/runs?source=${encodeURIComponent(source)}` : "/api/runs";
  const res = await fetch(url);
  if (!res.ok) throw new Error(`past-runs fetch failed: ${res.status}`);
  return res.json();
}

export async function fetchRunResults(id: string): Promise<{ run_id: string; questions: MCQ[] }> {
  const res = await fetch(`/api/runs/${id}/final`);
  if (!res.ok) throw new Error(`run fetch failed: ${res.status}`);
  return res.json();
}

export async function fetchFinal(runId: string): Promise<{ run_id: string; questions: any[] }> {
  const res = await fetch(`/api/runs/${runId}/final`);
  if (!res.ok) throw new Error(`final fetch failed: ${res.status}`);
  return res.json();
}

export async function health() {
  const res = await fetch("/api/health");
  return res.json();
}

/**
 * Stream the SSE response from POST /api/generate.
 * Returns a cancel() function.
 */
export function startGeneration(
  req: GenerateRequest,
  onEvent: (evt: StreamEvent) => void,
  onDone: () => void,
  onError: (e: Error) => void,
): () => void {
  const ctrl = new AbortController();
  let cancelled = false;

  (async () => {
    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(req),
        signal: ctrl.signal,
      });

      if (!res.ok || !res.body) {
        throw new Error(`generate failed: ${res.status} ${await res.text().catch(() => "")}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";

      while (!cancelled) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });

        // SSE frames are separated by blank lines.
        let sep: number;
        while ((sep = buf.indexOf("\n\n")) !== -1) {
          const frame = buf.slice(0, sep);
          buf = buf.slice(sep + 2);
          const evt = parseFrame(frame);
          if (evt) {
            onEvent(evt);
            if (evt.type === "workflow_done" || evt.type === "error") {
              // workflow finished — let the stream close naturally
            }
          }
        }
      }
      onDone();
    } catch (e) {
      if (cancelled) return;
      onError(e instanceof Error ? e : new Error(String(e)));
    }
  })();

  return () => {
    cancelled = true;
    ctrl.abort();
  };
}

function parseFrame(frame: string): StreamEvent | null {
  let type = "message";
  let data = "";
  for (const rawLine of frame.split("\n")) {
    const line = rawLine.trimEnd();
    if (!line || line.startsWith(":")) continue;
    if (line.startsWith("event:")) {
      type = line.slice(6).trim();
    } else if (line.startsWith("data:")) {
      data += (data ? "\n" : "") + line.slice(5).trim();
    }
  }
  if (!data) return null;
  try {
    return { type, data: JSON.parse(data) };
  } catch {
    return { type, data };
  }
}
