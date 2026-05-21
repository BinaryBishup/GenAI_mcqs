import { NextRequest } from "next/server";
import { SSEStream } from "@/lib/sse";
import { runWorkflow } from "@/lib/runner";
import type { GenerateRequest } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  let body: GenerateRequest;
  try {
    body = (await req.json()) as GenerateRequest;
  } catch {
    return new Response(JSON.stringify({ error: "invalid JSON" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!body.topic?.trim()) {
    return new Response(JSON.stringify({ error: "topic is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const stream = new SSEStream();

  // Kick off the workflow without awaiting so we can return the stream immediately.
  // SSE events are pushed via stream.send(...) as the workflow progresses.
  (async () => {
    try {
      await runWorkflow(body, (evt) => stream.send(evt.type, evt.data));
    } catch (err) {
      stream.send("error", {
        phase: "workflow",
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      stream.close();
    }
  })();

  return stream.toResponse();
}
