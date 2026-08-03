import type { NextRequest } from "next/server";
import { sessionFromRequest } from "@/lib/server/auth";
import type { Team } from "@/lib/types";

/** Header the client sends to pick which of its visible teams a request is scoped to. */
export const TEAM_HEADER = "x-smartcogen-team";

/**
 * Resolve the signed-in user's team scope from the request's session cookie.
 * The team grants are baked into the signed JWT at sign-in, so reading them
 * costs no query and cannot be forged.
 *
 * `team` is the ACTIVE team for this request: the x-smartcogen-team header when
 * it names one of the user's visible teams, else the first visible team — so
 * the header can select among grants but never escalate beyond them. `teams` is
 * the full visible list. Returns nulls/empty when the session is absent or invalid.
 */
export async function getUserTeam(
  req: NextRequest,
): Promise<{ team: Team | null; teams: Team[]; userId: string | null; name: string | null }> {
  const session = await sessionFromRequest(req);
  if (!session) return { team: null, teams: [], userId: null, name: null };

  const teams = session.teams;
  const requested = req.headers.get(TEAM_HEADER) as Team | null;
  const team = requested && teams.includes(requested) ? requested : (teams[0] ?? null);
  return { team, teams, userId: session.id, name: session.name };
}
