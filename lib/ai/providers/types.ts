// The contract every LLM driver implements. Kept minimal on purpose: this is
// the entire surface the generation pipeline uses.

export interface LlmMessage {
  role: "user" | "assistant";
  content: string;
}

export interface CompleteRequest {
  /** Provider-specific model id, from env.modelFor(quality). */
  model: string;
  maxTokens: number;
  /** Single system prompt. Drivers that have no system role prepend it. */
  system?: string;
  messages: LlmMessage[];
  /**
   * Hint that `system` is a large, stable prefix worth caching across calls.
   * Anthropic maps this to cache_control; drivers without caching ignore it.
   * Purely an optimisation — never affects the response.
   */
  cacheSystem?: boolean;
}

export interface CompleteResult {
  /** All text blocks of the reply, concatenated. */
  text: string;
  /** Why generation stopped, if the provider reports it — used in error logs
   *  to distinguish a truncated reply from a malformed one. */
  stopReason: string | null;
  inputTokens: number;
  outputTokens: number;
}

export interface LlmProvider {
  readonly name: string;

  complete(req: CompleteRequest): Promise<CompleteResult>;

  /**
   * Extract the assessable text of a PDF.
   *
   * Anthropic reads PDFs natively, so its driver passes the bytes to the model
   * with `system` as the extraction instruction. A driver whose model cannot
   * accept documents must extract the text locally first (and then it may well
   * ignore `system` entirely). Optional: a driver that supports neither should
   * omit it, and /api/scratch/ingest will reject PDFs with a clear message
   * rather than failing obscurely.
   */
  readPdfText?(base64Pdf: string, system: string, maxTokens: number): Promise<string>;
}
