import type {
  AdminBank, GenerateRequest, MCQ, PastRunSummary, SampleCatalog, SamplePreviewResult,
  SampleTopic, StreamEvent,
} from "./types";
import { supabaseBrowser } from "./supabase-browser";

/** Bearer header for the current Supabase session, or {} when signed out. The
 *  server reads the team off this token to scope every request. */
// Shared in-flight refresh so concurrent callers (e.g. the dashboard poller,
// which dev StrictMode double-mounts) don't race separate refreshSession calls
// and invalidate each other's token — the cause of intermittent 401s.
let refreshInFlight: ReturnType<ReturnType<typeof supabaseBrowser>["auth"]["refreshSession"]> | null = null;

async function authHeader(): Promise<Record<string, string>> {
  try {
    const supa = supabaseBrowser();
    const { data } = await supa.auth.getSession();
    let session = data.session;
    // The stored access token may be expired (tab idle past its 1h lifetime);
    // getSession returns it as-is. Refresh when it's missing or within 60s of
    // expiry, sharing one in-flight refresh across concurrent callers.
    const expiringSoon = session?.expires_at ? session.expires_at * 1000 < Date.now() + 60_000 : !session;
    if (expiringSoon) {
      if (!refreshInFlight) {
        refreshInFlight = supa.auth.refreshSession();
        refreshInFlight.finally(() => { refreshInFlight = null; });
      }
      const refreshed = await refreshInFlight;
      session = refreshed.data.session ?? session;
    }
    const token = session?.access_token;
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}

/**
 * `fetch` with a small retry on transport-level failures. It only *throws* on
 * network errors (DNS, connection reset, the Next.js dev server's intermittent
 * ERR_ALPN_NEGOTIATION_FAILED on a reused keep-alive socket) — never on HTTP
 * error statuses — so a thrown error means the request never completed and is
 * safe to retry with a fresh connection. A File/Blob body is re-readable, so
 * the same FormData can be replayed.
 */
async function fetchWithRetry(input: RequestInfo | URL, init?: RequestInit, attempts = 3): Promise<Response> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fetch(input, init);
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 200 * (i + 1)));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export async function fetchCatalog(): Promise<SampleCatalog> {
  const res = await fetchWithRetry("/api/samples", { cache: "no-store", headers: await authHeader() });
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
  const res = await fetchWithRetry("/api/samples/upload", { method: "POST", body: form, headers: await authHeader() });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error ?? `upload failed: ${res.status}`);
  return data as UploadSampleResult;
}

/** Parse a workbook and return its questions grouped by difficulty — no DB write. */
export async function previewSample(file: File, topic: string): Promise<SamplePreviewResult> {
  const form = new FormData();
  form.append("file", file);
  if (topic) form.append("topic", topic);
  const res = await fetchWithRetry("/api/samples/preview", { method: "POST", body: form });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error ?? `preview failed: ${res.status}`);
  return data as SamplePreviewResult;
}

export async function fetchPastRuns(source?: string): Promise<{ count: number; runs: PastRunSummary[] }> {
  const url = source ? `/api/runs?source=${encodeURIComponent(source)}` : "/api/runs";
  const res = await fetch(url, { headers: await authHeader() });
  if (!res.ok) throw new Error(`past-runs fetch failed: ${res.status}`);
  return res.json();
}

export async function fetchRunResults(id: string): Promise<{ run_id: string; questions: MCQ[] }> {
  const res = await fetch(`/api/runs/${id}/final`);
  if (!res.ok) throw new Error(`run fetch failed: ${res.status}`);
  return res.json();
}

/** Full run record + current questions. Used to poll an in-progress run. */
export async function fetchRun(id: string): Promise<{ run: PastRunSummary & { status: string }; mcqs: MCQ[] }> {
  const res = await fetch(`/api/runs/${id}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`run fetch failed: ${res.status}`);
  return res.json();
}

/** Stored progress events for a run, in order — replays the live Timeline. */
export async function fetchRunEvents(id: string): Promise<{ run_id: string; events: StreamEvent[] }> {
  const res = await fetch(`/api/runs/${id}/events`, { cache: "no-store" });
  if (!res.ok) throw new Error(`run events fetch failed: ${res.status}`);
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

/** Persist an edit to one MCQ (by run + index); server re-runs the answer-check. */
export async function updateMcq(runId: string, index: number, mcq: MCQ): Promise<MCQ> {
  const res = await fetch("/api/mcqs", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ run_id: runId, index, mcq }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error ?? `update failed: ${res.status}`);
  return data.mcq as MCQ;
}

/** Regenerate / revise the inline SVG diagram for one MCQ (persisted). Returns the new SVG. */
export async function regenMcqImage(runId: string, index: number, instruction?: string): Promise<string> {
  const res = await fetch("/api/mcqs/image", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeader()) },
    body: JSON.stringify({ run_id: runId, index, instruction }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error ?? `image regen failed: ${res.status}`);
  return data.image_svg as string;
}

/** Persist one reviewer's decision for a question (approved/rejected/duplicate/pending). */
export async function setMcqReview(
  runId: string,
  index: number,
  status: "pending" | "approved" | "rejected" | "duplicate",
): Promise<void> {
  const res = await fetch(`/api/runs/${runId}/review`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeader()) },
    body: JSON.stringify({ index, status }),
  });
  if (!res.ok) throw new Error(`review save failed: ${res.status}`);
}

/** Mark a run finalised (or undo). */
export async function finaliseRun(runId: string, undo = false): Promise<void> {
  const res = await fetch(`/api/runs/${runId}/finalise`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeader()) },
    body: JSON.stringify({ undo }),
  });
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new Error(d?.error ?? `finalise failed: ${res.status}`);
  }
}

/** Publish a finalised run to the shared Admin inventory (or undo). */
export async function publishRun(runId: string, undo = false): Promise<void> {
  const res = await fetch(`/api/runs/${runId}/publish`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeader()) },
    body: JSON.stringify({ undo }),
  });
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new Error(d?.error ?? `publish failed: ${res.status}`);
  }
}

/** The shared Admin inventory: published sets across all teams. */
export async function fetchAdminInventory(): Promise<{ count: number; banks: AdminBank[] }> {
  const res = await fetch("/api/banks/admin", { headers: await authHeader() });
  if (!res.ok) throw new Error(`admin inventory fetch failed: ${res.status}`);
  return res.json();
}

/** Ask the model to modify one MCQ per a natural-language instruction (not persisted). */
export async function aiModifyMcq(mcq: MCQ, instruction: string): Promise<MCQ> {
  const res = await fetch("/api/mcqs/modify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mcq, instruction }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error ?? `modify failed: ${res.status}`);
  return data.mcq as MCQ;
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
        headers: { "Content-Type": "application/json", ...(await authHeader()) },
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
