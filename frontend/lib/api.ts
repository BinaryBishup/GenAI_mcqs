import { GenerateRequest, SampleCatalog, StreamEvent } from "./types";

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";

export async function fetchCatalog(): Promise<SampleCatalog> {
  const res = await fetch(`${BACKEND}/api/samples/catalog`);
  if (!res.ok) throw new Error(`catalog failed: ${res.status}`);
  return res.json();
}

export async function startGeneration(req: GenerateRequest): Promise<{ session_id: string }> {
  const res = await fetch(`${BACKEND}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  if (!res.ok) throw new Error(`generate failed: ${res.status} ${await res.text()}`);
  return res.json();
}

export async function health() {
  const res = await fetch(`${BACKEND}/api/health`);
  return res.json();
}

export function subscribe(
  sessionId: string,
  onEvent: (evt: StreamEvent) => void,
  onDone: () => void,
  onError: (e: Event) => void,
): () => void {
  const url = `${BACKEND}/api/events/${sessionId}`;
  const es = new EventSource(url);
  let finished = false;

  const finish = () => {
    if (finished) return;
    finished = true;
    es.close();
    onDone();
  };

  const types = [
    "workflow_start", "phase", "generated",
    "question_start", "plag_check", "plag_unique", "plag_flagged",
    "plag_gave_up", "revamping",
    "code_verify", "code_verified",
    "question_done", "workflow_done",
    "warn", "error",
  ];
  for (const t of types) {
    es.addEventListener(t, (ev: MessageEvent) => {
      try { onEvent({ type: t, data: JSON.parse(ev.data) }); }
      catch { onEvent({ type: t, data: ev.data }); }
      if (t === "workflow_done" || t === "error") finish();
    });
  }

  // EventSource auto-reconnects on close. Once we've finished, suppress the
  // browser's reconnection error; only surface errors that happen mid-stream.
  es.onerror = (e) => {
    if (finished) return;
    // The server closed the stream after the workflow ended; treat as done.
    if (es.readyState === EventSource.CLOSED) {
      finish();
      return;
    }
    onError(e);
  };

  return () => { finished = true; es.close(); };
}
