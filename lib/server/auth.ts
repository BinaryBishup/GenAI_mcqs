// Self-hosted authentication: users live in the application's own Postgres,
// passwords are bcrypt hashes, and a session is an HS256 JWT carried in an
// httpOnly cookie. No external identity provider is involved, so the whole app
// runs inside a VPC with nothing but Postgres for company.
//
// Server-only. Importing this from a client component will (correctly) fail to
// build — the browser talks to /api/auth/* instead.

import { compare, hash } from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import type { NextRequest } from "next/server";
import { pgPool } from "@/lib/server/db";
import { TEAMS, type Team, type TeamMeta } from "@/lib/types";

export const SESSION_COOKIE = "smartcogen_session";

const BCRYPT_ROUNDS = 12;

function ttlSeconds(): number {
  const hours = Number(process.env.AUTH_SESSION_TTL_HOURS || "168"); // 7 days
  return Math.max(1, Math.floor(hours * 3600));
}

function secret(): Uint8Array {
  const s = process.env.AUTH_JWT_SECRET;
  if (!s || s.trim().length < 32) {
    throw new Error("AUTH_JWT_SECRET is missing or shorter than 32 characters");
  }
  return new TextEncoder().encode(s);
}

/** A row of the `users` table, minus the password hash. */
export interface AuthUserRecord {
  id: string;
  email: string;
  name: string;
  team: TeamMeta;
  teams: Team[];
}

/** What we put in — and read back out of — the session JWT. */
export interface SessionClaims extends AuthUserRecord {}

type UserRow = {
  id: string;
  email: string;
  full_name: string | null;
  team: string;
  teams: string[] | null;
};

/**
 * Teams the user may view. A primary team of "ALL" opens every team; the
 * `teams` column grants extras beyond the primary one. Unknown values are
 * dropped so a stale grant can never widen access.
 */
function visibleTeams(team: string, extras: string[] | null): Team[] {
  if (team === "ALL") return [...TEAMS];
  const raw = [team, ...(extras ?? [])];
  return [...new Set(raw.filter((t): t is Team => TEAMS.includes(t as Team)))];
}

function toRecord(row: UserRow): AuthUserRecord {
  const teams = visibleTeams(row.team, row.teams);
  return {
    id: row.id,
    email: row.email,
    name: row.full_name || row.email.split("@")[0],
    team: (row.team as TeamMeta) ?? "HACK",
    teams: teams.length ? teams : ["HACK"],
  };
}

const USER_COLS = `id, email, full_name, team, teams`;

export function hashPassword(plain: string): Promise<string> {
  return hash(plain, BCRYPT_ROUNDS);
}

/**
 * Verify an email/password pair. Returns null for a wrong password, an unknown
 * email, or a deactivated account — the caller must not distinguish between
 * them in its response, or the endpoint becomes an account enumerator.
 */
export async function verifyCredentials(email: string, password: string): Promise<AuthUserRecord | null> {
  const { rows } = await pgPool().query<UserRow & { password_hash: string; is_active: boolean }>(
    `select ${USER_COLS}, password_hash, is_active from users where lower(email) = lower($1) limit 1`,
    [email.trim()],
  );
  const row = rows[0];
  // Hash a throwaway value when the user is missing so the response time does
  // not reveal whether the address exists.
  if (!row) {
    await compare(password, "$2a$12$C6UzMDM.H6dfI/f/IKcEe.rEvIhcVWlHqmnW7pRoQZlyF7oQ2QhLK");
    return null;
  }
  if (!row.is_active) return null;
  if (!(await compare(password, row.password_hash))) return null;
  return toRecord(row);
}

/** Re-read a user by id — used to refresh claims that may have changed since sign-in. */
export async function getUserById(id: string): Promise<AuthUserRecord | null> {
  const { rows } = await pgPool().query<UserRow>(
    `select ${USER_COLS} from users where id = $1 and is_active limit 1`,
    [id],
  );
  return rows[0] ? toRecord(rows[0]) : null;
}

export async function recordLogin(id: string): Promise<void> {
  await pgPool().query(`update users set last_login_at = now() where id = $1`, [id]);
}

export async function signSession(user: AuthUserRecord): Promise<string> {
  return new SignJWT({
    email: user.email,
    name: user.name,
    team: user.team,
    teams: user.teams,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds()}s`)
    .sign(secret());
}

/** Verify a session token. Returns null on any failure (expired, tampered, unset secret). */
export async function verifySession(token: string): Promise<SessionClaims | null> {
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ["HS256"] });
    if (!payload.sub) return null;
    const teams = Array.isArray(payload.teams)
      ? (payload.teams as string[]).filter((t): t is Team => TEAMS.includes(t as Team))
      : [];
    return {
      id: payload.sub,
      email: String(payload.email ?? ""),
      name: String(payload.name ?? ""),
      team: (payload.team as TeamMeta) ?? "HACK",
      teams: teams.length ? teams : ["HACK"],
    };
  } catch {
    return null;
  }
}

/** Read and verify the session on an incoming request. Null when signed out. */
export async function sessionFromRequest(req: NextRequest): Promise<SessionClaims | null> {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  return token ? verifySession(token) : null;
}

/** Cookie attributes for the session. Secure is dropped in dev so http://localhost works. */
export function sessionCookie(token: string) {
  return {
    name: SESSION_COOKIE,
    value: token,
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: ttlSeconds(),
  };
}

export function clearedSessionCookie() {
  return { ...sessionCookie(""), maxAge: 0 };
}
