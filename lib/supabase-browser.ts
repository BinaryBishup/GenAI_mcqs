"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Browser auth client (publishable/anon key, session persisted to localStorage).
// Used only for sign-in/out and reading the current session; all data access
// still goes through the server API routes (which verify the JWT).
let _client: SupabaseClient | null = null;

export function supabaseBrowser(): SupabaseClient {
  if (_client) return _client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  _client = createClient(url, key, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  });
  return _client;
}
