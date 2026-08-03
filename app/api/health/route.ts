import { NextResponse } from "next/server";
import { pgPool } from "@/lib/server/db";

export const runtime = "nodejs";

function envSet(name: string): boolean {
  const v = process.env[name]?.trim();
  return !!v && !["sk-ant-...", "..."].includes(v);
}

/** Round-trips a trivial query so the check fails when Postgres is unreachable,
 *  not merely when DATABASE_URL happens to be set. */
async function databaseReachable(): Promise<boolean> {
  if (!envSet("DATABASE_URL")) return false;
  try {
    await pgPool().query("select 1");
    return true;
  } catch {
    return false;
  }
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    env: {
      anthropic: envSet("ANTHROPIC_API_KEY"),
      database: await databaseReachable(),
      auth: envSet("AUTH_JWT_SECRET"),
    },
    models: {
      fast: process.env.ANTHROPIC_MODEL_FAST ?? "claude-haiku-4-5",
      balanced: process.env.ANTHROPIC_MODEL_BALANCED ?? "claude-sonnet-4-6",
      highest: process.env.ANTHROPIC_MODEL_HIGHEST ?? "claude-opus-4-7",
    },
  });
}
