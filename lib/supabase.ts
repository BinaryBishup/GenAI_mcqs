import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { env } from "./env";
import { pgRestClient } from "./pg-rest";

let _admin: SupabaseClient | null = null;
let _auth: SupabaseClient | null = null;
let _pg: ReturnType<typeof pgRestClient> | null = null;

function realClient(): SupabaseClient {
  return createClient(env.supabaseUrl(), env.supabaseServiceKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Server-side DATA client. Two modes:
 *  - `DATABASE_URL` set (EC2/RDS deployment) → a direct-Postgres adapter that
 *    exposes the supabase-js query surface the app uses (see lib/pg-rest.ts).
 *  - otherwise → the regular Supabase service-role client (PostgREST).
 * Unsetting DATABASE_URL is the instant rollback path to Supabase-hosted data.
 * NEVER expose either to the browser.
 */
export function supabaseAdmin(): SupabaseClient {
  if (process.env.DATABASE_URL) {
    if (!_pg) _pg = pgRestClient();
    return _pg as unknown as SupabaseClient;
  }
  if (!_admin) _admin = realClient();
  return _admin;
}

/** AUTH admin client — always Supabase, regardless of where the data lives
 *  (auth migrates separately in Phase 3). Used to verify user JWTs. */
export function supabaseAuthAdmin(): SupabaseClient {
  if (!_auth) _auth = realClient();
  return _auth;
}
