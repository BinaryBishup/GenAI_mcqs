import type { NextRequest } from "next/server";
import { supabaseAdmin } from "./supabase";
import { TEAMS, type Team } from "./types";

/** Header the client sends to pick which of its visible teams a request is scoped to. */
export const TEAM_HEADER = "x-assessly-team";

/**
 * Teams the user may view. "ALL" in the metadata team opens every team; the
 * optional metadata `teams` array grants extra teams beyond the primary one
 * (e.g. Deepika: team "Cognitive" + teams ["SEG"]). Unknown values are dropped.
 */
function visibleTeams(meta: { team?: string; teams?: string[] }): Team[] {
  if (meta.team === "ALL") return [...TEAMS];
  const raw = [meta.team, ...(meta.teams ?? [])];
  return [...new Set(raw.filter((t): t is Team => TEAMS.includes(t as Team)))];
}

/**
 * Resolve the signed-in user's team scope from the request's bearer token. The
 * team grants live in the user's auth metadata (set at provisioning time), so we
 * read them straight off the verified JWT — no profiles query (which would hit RLS).
 *
 * `team` is the ACTIVE team for this request: the x-assessly-team header when it
 * names one of the user's visible teams, else the first visible team. `teams` is
 * the full visible list. Returns nulls/empty when the token is missing or invalid.
 */
export async function getUserTeam(req: NextRequest): Promise<{ team: Team | null; teams: Team[]; userId: string | null; name: string | null }> {
  const header = req.headers.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return { team: null, teams: [], userId: null, name: null };
  try {
    const { data, error } = await supabaseAdmin().auth.getUser(token);
    if (error || !data.user) return { team: null, teams: [], userId: null, name: null };
    const meta = (data.user.user_metadata ?? {}) as { team?: string; teams?: string[]; full_name?: string };
    const teams = visibleTeams(meta);
    const requested = req.headers.get(TEAM_HEADER) as Team | null;
    const team = requested && teams.includes(requested) ? requested : (teams[0] ?? null);
    const name = meta.full_name || data.user.email?.split("@")[0] || null;
    return { team, teams, userId: data.user.id, name };
  } catch {
    return { team: null, teams: [], userId: null, name: null };
  }
}
