import type { NextRequest } from "next/server";
import { supabaseAdmin } from "./supabase";
import type { Team } from "./types";

/**
 * Resolve the signed-in user's team from the request's bearer token. The team
 * lives in the user's auth metadata (set at provisioning time), so we read it
 * straight off the verified JWT — no profiles query (which would hit RLS).
 * Returns nulls when the token is missing or invalid.
 */
export async function getUserTeam(req: NextRequest): Promise<{ team: Team | null; userId: string | null; name: string | null }> {
  const header = req.headers.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return { team: null, userId: null, name: null };
  try {
    const { data, error } = await supabaseAdmin().auth.getUser(token);
    if (error || !data.user) return { team: null, userId: null, name: null };
    const meta = (data.user.user_metadata ?? {}) as { team?: Team; full_name?: string };
    const team = (meta.team as Team | undefined) ?? null;
    const name = meta.full_name || data.user.email?.split("@")[0] || null;
    return { team, userId: data.user.id, name };
  } catch {
    return { team: null, userId: null, name: null };
  }
}
