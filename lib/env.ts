function required(name: string): string {
  const v = process.env[name];
  if (!v || !v.trim()) throw new Error(`Missing required env var: ${name}`);
  return v;
}

function optional(name: string, fallback: string): string {
  return process.env[name]?.trim() || fallback;
}

export const env = {
  /** Only read by the Anthropic driver. */
  anthropicKey: () => required("ANTHROPIC_API_KEY"),
  /**
   * Model id for a quality tier, resolved provider-neutrally: LLM_MODEL_* wins,
   * falling back to the legacy ANTHROPIC_MODEL_* names and then to Claude ids.
   * Point LLM_MODEL_* at the in-house model ids when switching providers.
   */
  modelFor: (quality: "fast" | "balanced" | "highest") => {
    const pick = (tier: string, fallback: string) =>
      process.env[`LLM_MODEL_${tier}`]?.trim() ||
      process.env[`ANTHROPIC_MODEL_${tier}`]?.trim() ||
      fallback;
    if (quality === "fast") return pick("FAST", "claude-haiku-4-5");
    if (quality === "balanced") return pick("BALANCED", "claude-sonnet-4-6");
    return pick("HIGHEST", "claude-opus-4-7");
  },
  /** Postgres connection string — the app's only datastore. */
  databaseUrl: () => required("DATABASE_URL"),
  /** HMAC key for session JWTs. Generate with `openssl rand -base64 48`. */
  jwtSecret: () => {
    const s = required("AUTH_JWT_SECRET");
    if (s.trim().length < 32) throw new Error("AUTH_JWT_SECRET must be at least 32 characters");
    return s;
  },
  /** Optional. If absent, the plag check uses only the local corpus. */
  tavilyKey: () => process.env.TAVILY_API_KEY?.trim() || null,
  /** token_set_ratio threshold above which we flag as plagiarized (0–1). */
  plagFuzzThreshold: () => Number(optional("PLAG_FUZZ_THRESHOLD", "0.85")),
};
