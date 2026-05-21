import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { env } from "./env";

let _admin: SupabaseClient | null = null;

/** Server-side admin client (service role key). NEVER expose to the browser. */
export function supabaseAdmin(): SupabaseClient {
  if (_admin) return _admin;
  _admin = createClient(env.supabaseUrl(), env.supabaseServiceKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return _admin;
}
