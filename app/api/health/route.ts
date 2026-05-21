import { NextResponse } from "next/server";

export const runtime = "nodejs";

function envSet(name: string): boolean {
  const v = process.env[name]?.trim();
  return !!v && !["sk-ant-...", "..."].includes(v);
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    env: {
      anthropic: envSet("ANTHROPIC_API_KEY"),
      supabase: envSet("NEXT_PUBLIC_SUPABASE_URL") && envSet("SUPABASE_SERVICE_ROLE_KEY"),
      voyage: envSet("VOYAGE_API_KEY"),
      exa: envSet("EXA_API_KEY"),
      judge0: envSet("JUDGE0_RAPIDAPI_KEY"),
    },
    models: {
      fast: process.env.ANTHROPIC_MODEL_FAST ?? "claude-haiku-4-5",
      balanced: process.env.ANTHROPIC_MODEL_BALANCED ?? "claude-sonnet-4-6",
      highest: process.env.ANTHROPIC_MODEL_HIGHEST ?? "claude-opus-4-7",
    },
  });
}
