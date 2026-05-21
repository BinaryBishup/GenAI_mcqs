/** Server-Sent Events helper for Next.js Route Handlers. */
export class SSEStream {
  private encoder = new TextEncoder();
  private controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  private closed = false;

  readonly readable: ReadableStream<Uint8Array>;

  constructor() {
    this.readable = new ReadableStream<Uint8Array>({
      start: (c) => { this.controller = c; },
      cancel: () => { this.closed = true; },
    });
  }

  send(type: string, data: unknown): void {
    if (this.closed || !this.controller) return;
    const payload =
      `event: ${type}\n` +
      `data: ${JSON.stringify(data)}\n\n`;
    try {
      this.controller.enqueue(this.encoder.encode(payload));
    } catch {
      this.closed = true;
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    try { this.controller?.close(); } catch { /* already closed */ }
  }

  toResponse(): Response {
    return new Response(this.readable, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  }
}
