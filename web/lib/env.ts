function required(name: string): string {
  const v = process.env[name];
  if (!v || !v.trim()) throw new Error(`Missing required env var: ${name}`);
  return v;
}

function optional(name: string, fallback: string): string {
  return process.env[name]?.trim() || fallback;
}

export const env = {
  anthropicKey: () => required("ANTHROPIC_API_KEY"),
  modelFor: (quality: "fast" | "balanced" | "highest") => {
    if (quality === "fast") return optional("ANTHROPIC_MODEL_FAST", "claude-haiku-4-5");
    if (quality === "balanced") return optional("ANTHROPIC_MODEL_BALANCED", "claude-sonnet-4-6");
    return optional("ANTHROPIC_MODEL_HIGHEST", "claude-opus-4-7");
  },
  supabaseUrl: () => required("NEXT_PUBLIC_SUPABASE_URL"),
  /** Accept either the new publishable key or the legacy anon key. */
  supabaseAnonKey: () =>
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ||
    (() => { throw new Error("Missing NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (or legacy NEXT_PUBLIC_SUPABASE_ANON_KEY)"); })(),
  /**
   * Server-only secret key. Falls back to the publishable key for the v1 single-user
   * setup where RLS is off (publishable key has full write access then). For
   * production, set SUPABASE_SECRET_KEY (sb_secret_...) or SUPABASE_SERVICE_ROLE_KEY.
   */
  supabaseServiceKey: () =>
    process.env.SUPABASE_SECRET_KEY?.trim() ||
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ||
    (() => { throw new Error("Missing SUPABASE_SECRET_KEY / SERVICE_ROLE_KEY / PUBLISHABLE_KEY"); })(),
  voyageKey: () => required("VOYAGE_API_KEY"),
  voyageModel: () => optional("VOYAGE_EMBEDDING_MODEL", "voyage-3"),
  exaKey: () => process.env.EXA_API_KEY?.trim() || null,
  judge0Key: () => required("JUDGE0_RAPIDAPI_KEY"),
  judge0Host: () => optional("JUDGE0_RAPIDAPI_HOST", "judge0-ce.p.rapidapi.com"),
  plagThreshold: () => Number(optional("PLAG_COSINE_THRESHOLD", "0.86")),
  plagExaLow: () => Number(optional("PLAG_EXA_FALLBACK_LOW", "0.55")),
  plagExaHigh: () => Number(optional("PLAG_EXA_FALLBACK_HIGH", "0.86")),
};
