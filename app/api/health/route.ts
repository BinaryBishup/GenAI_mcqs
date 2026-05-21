import { NextResponse } from "next/server";

export const runtime = "nodejs";

function envSet(name: string): boolean {
  const v = process.env[name]?.trim();
  return !!v && !["sk-ant-...", "..."].includes(v);
}

function supabaseKeySet(): boolean {
  return envSet("SUPABASE_SECRET_KEY")
      || envSet("SUPABASE_SERVICE_ROLE_KEY")
      || envSet("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY")
      || envSet("NEXT_PUBLIC_SUPABASE_ANON_KEY");
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    env: {
      anthropic: envSet("ANTHROPIC_API_KEY"),
      supabase: envSet("NEXT_PUBLIC_SUPABASE_URL") && supabaseKeySet(),
      judge0: envSet("JUDGE0_RAPIDAPI_KEY"),
    },
    models: {
      fast: process.env.ANTHROPIC_MODEL_FAST ?? "claude-haiku-4-5",
      balanced: process.env.ANTHROPIC_MODEL_BALANCED ?? "claude-sonnet-4-6",
      highest: process.env.ANTHROPIC_MODEL_HIGHEST ?? "claude-opus-4-7",
    },
  });
}
