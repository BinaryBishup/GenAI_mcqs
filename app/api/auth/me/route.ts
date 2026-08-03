import { NextResponse, type NextRequest } from "next/server";
import { clearedSessionCookie, getUserById, sessionFromRequest } from "@/lib/server/auth";

export const runtime = "nodejs";

/**
 * The client's session-restore call. Re-reads the row rather than trusting the
 * cookie's claims, so a revoked account or a changed team grant takes effect on
 * the next page load instead of when the token finally expires.
 */
export async function GET(req: NextRequest) {
  const claims = await sessionFromRequest(req);
  if (!claims) return NextResponse.json({ user: null }, { status: 401 });

  const user = await getUserById(claims.id);
  if (!user) {
    const res = NextResponse.json({ user: null }, { status: 401 });
    res.cookies.set(clearedSessionCookie());
    return res;
  }
  return NextResponse.json({ user });
}
