// One-off: reset every user's password to Test@123 (except the owner) and flag
// them to set a private password on next login. Run: node scripts/reset-passwords.mjs
import { config } from "dotenv";
config({ path: ".env.local" }); config({ path: ".env" });
import { createClient } from "@supabase/supabase-js";

const NEW_PASSWORD = "Test@123";
const SKIP = new Set(["aashish.soni@mercer.com"]);

const supa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data, error } = await supa.auth.admin.listUsers({ page: 1, perPage: 200 });
if (error) { console.error("listUsers failed:", error.message); process.exit(1); }

let done = 0, skipped = 0, failed = 0;
for (const u of data.users) {
  const email = u.email ?? "";
  if (SKIP.has(email.toLowerCase())) { console.log("SKIP  ", email); skipped++; continue; }
  const meta = { ...(u.user_metadata ?? {}), must_reset_password: true };
  const { error: e } = await supa.auth.admin.updateUserById(u.id, { password: NEW_PASSWORD, user_metadata: meta });
  if (e) { console.log("FAIL  ", email, "-", e.message); failed++; }
  else { console.log("RESET ", email); done++; }
}
console.log(`\nReset ${done}, skipped ${skipped}, failed ${failed}, total ${data.users.length}`);
