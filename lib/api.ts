import type {
  GenerateRequest, MCQ, PastRunSummary, SampleCatalog, SamplePreviewResult,
  SampleTopic, ScratchBrief, ScratchChatMsg, ScratchDoc, ScratchInterviewReply,
  ScratchVariant, StreamEvent, Tag, TagItemType,
} from "./types";
import { supabaseBrowser } from "./supabase-browser";

/** localStorage key for the team the user is currently viewing (multi-team users). */
export const LS_VIEW_TEAM = "assessly.viewTeam";

/** Bearer header for the current Supabase session, or {} when signed out. The
 *  server reads the team off this token to scope every request; the
 *  x-assessly-team header picks WHICH of the user's visible teams applies
 *  (validated server-side against the JWT's grants, so it can't escalate). */
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
    const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
    const viewTeam = localStorage.getItem(LS_VIEW_TEAM);
    if (viewTeam) headers["x-assessly-team"] = viewTeam;
    return headers;
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

/** Rename a Local bank; tag memberships and run references follow the new name. */
export async function renameSample(filename: string, name: string): Promise<{ filename: string }> {
  const res = await fetchWithRetry(`/api/samples/${encodeURIComponent(filename)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...(await authHeader()) },
    body: JSON.stringify({ name }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `rename failed: ${res.status}`);
  return body;
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

/** Mark a run finalised on the server (team-wide, survives browser changes). */
export async function finaliseRun(runId: string, by?: string | null): Promise<void> {
  const res = await fetch(`/api/runs/${runId}/finalise`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ by: by ?? undefined }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data?.error ?? `finalise failed: ${res.status}`);
  }
}

/** Persist one question's review decision (approve/reject/duplicate/pending). */
export async function saveReviewDecision(
  runId: string,
  index: number,
  status: "pending" | "approved" | "rejected" | "duplicate",
  reason?: string,
  by?: string | null,
): Promise<void> {
  const res = await fetch(`/api/runs/${runId}/review`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ index, status, reason: reason || undefined, by: by ?? undefined }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data?.error ?? `review save failed: ${res.status}`);
  }
}

export async function health() {
  const res = await fetch("/api/health");
  return res.json();
}

// ---- Tags: team-scoped labels grouping runs + sample banks ----

export async function fetchTags(): Promise<{ tags: Tag[] }> {
  const res = await fetch("/api/tags", { cache: "no-store", headers: await authHeader() });
  if (!res.ok) throw new Error(`tags fetch failed: ${res.status}`);
  return res.json();
}

export async function createTag(name: string, color: string): Promise<Tag> {
  const res = await fetch("/api/tags", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeader()) },
    body: JSON.stringify({ name, color }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error ?? `create tag failed: ${res.status}`);
  return data.tag as Tag;
}

export async function deleteTag(id: string): Promise<void> {
  const res = await fetch(`/api/tags/${id}`, { method: "DELETE", headers: await authHeader() });
  if (!res.ok) throw new Error(`delete tag failed: ${res.status}`);
}

export async function addTagItem(tagId: string, itemType: TagItemType, itemId: string): Promise<void> {
  const res = await fetch(`/api/tags/${tagId}/items`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeader()) },
    body: JSON.stringify({ item_type: itemType, item_id: itemId }),
  });
  if (!res.ok) throw new Error(`add to tag failed: ${res.status}`);
}

export async function removeTagItem(tagId: string, itemType: TagItemType, itemId: string): Promise<void> {
  const res = await fetch(`/api/tags/${tagId}/items`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json", ...(await authHeader()) },
    body: JSON.stringify({ item_type: itemType, item_id: itemId }),
  });
  if (!res.ok) throw new Error(`remove from tag failed: ${res.status}`);
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

// ---- Create-from-scratch chat wizard ----

/** Reduce an attached reference document to a digest the chat can carry. */
export async function ingestScratchDoc(file: File): Promise<ScratchDoc> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetchWithRetry("/api/scratch/ingest", { method: "POST", body: form, headers: await authHeader() });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error ?? `ingest failed: ${res.status}`);
  return data as ScratchDoc;
}

/** One interview turn: full transcript in, next question or finished brief out. */
export async function scratchInterview(messages: ScratchChatMsg[], docs: ScratchDoc[]): Promise<ScratchInterviewReply> {
  const res = await fetchWithRetry("/api/scratch/interview", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeader()) },
    body: JSON.stringify({ messages, docs }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error ?? `interview failed: ${res.status}`);
  return data as ScratchInterviewReply;
}

/** Generate 4 styled sample questions from a finished brief. */
export async function scratchSamples(brief: ScratchBrief, exclude?: string[]): Promise<ScratchVariant[]> {
  const res = await fetchWithRetry("/api/scratch/samples", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeader()) },
    body: JSON.stringify({ brief, exclude }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error ?? `samples failed: ${res.status}`);
  return (data.variants ?? []) as ScratchVariant[];
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
