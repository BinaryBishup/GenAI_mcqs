/**
 * Account administration. The app has no self-signup, no admin UI and no
 * password-reset flow, so accounts are provisioned from the command line
 * against DATABASE_URL. An account is just an email and a password.
 *
 *   npm run user:create  -- --email a@b.com --password 'x' --name "A B" --team HACK [--teams SEG,Domain]
 *   npm run user:list
 *   npm run user:passwd  -- --email a@b.com --password 'x'
 *   npm run user:disable -- --email a@b.com
 *   npm run user:enable  -- --email a@b.com
 *
 * --password is always explicit: nothing is generated and nothing is temporary.
 */
import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env.production" });
config({ path: ".env" });

import { hashPassword } from "../lib/server/auth";
import { pgPool } from "../lib/server/db";
import { TEAMS } from "../lib/types";

const VALID_TEAMS = [...TEAMS, "ALL"];
const MIN_PASSWORD = 8;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function die(msg: string): never {
  console.error(`error: ${msg}`);
  process.exit(1);
}

function requirePassword(): string {
  const pw = arg("password");
  if (!pw || pw.length < MIN_PASSWORD) die(`--password is required and must be at least ${MIN_PASSWORD} characters`);
  return pw;
}

function requireEmail(): string {
  const email = arg("email")?.trim();
  if (!email || !email.includes("@")) die("--email is required and must look like an address");
  return email;
}

function parseTeams(): { team: string; teams: string[] } {
  const team = (arg("team") ?? "HACK").trim();
  if (!VALID_TEAMS.includes(team as never)) {
    die(`--team must be one of: ${VALID_TEAMS.join(", ")}`);
  }
  const teams = (arg("teams") ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  const bad = teams.filter((t) => !TEAMS.includes(t as never));
  if (bad.length) die(`--teams has unknown values: ${bad.join(", ")} (valid: ${TEAMS.join(", ")})`);
  return { team, teams };
}

async function create() {
  const email = requireEmail();
  const { team, teams } = parseTeams();
  const name = arg("name") ?? email.split("@")[0];
  const password = requirePassword();

  const { rows } = await pgPool().query(
    `insert into users (email, password_hash, full_name, team, teams)
     values ($1, $2, $3, $4, $5)
     on conflict (lower(email)) do nothing
     returning id`,
    [email, await hashPassword(password), name, team, teams],
  );
  if (!rows[0]) die(`a user with email ${email} already exists`);

  console.log(`created ${email}`);
  console.log(`  name  ${name}`);
  console.log(`  team  ${team}${teams.length ? ` (+ ${teams.join(", ")})` : ""}`);
}

async function list() {
  const { rows } = await pgPool().query(
    `select email, full_name, team, teams, is_active, last_login_at
     from users order by lower(email)`,
  );
  if (!rows.length) {
    console.log("no users yet — create one with `npm run user:create -- --email ...`");
    return;
  }
  for (const r of rows) {
    const extra = r.teams?.length ? ` +${r.teams.join(",")}` : "";
    const flags = r.is_active ? "" : "DISABLED";
    const seen = r.last_login_at ? new Date(r.last_login_at).toISOString().slice(0, 10) : "never";
    console.log(
      `${r.email.padEnd(34)} ${String(r.team + extra).padEnd(22)} last login ${seen.padEnd(10)} ${flags}`,
    );
  }
}

/** Set a user's password outright. Not a reset flow — the admin chooses the value. */
async function passwd() {
  const email = requireEmail();
  const password = requirePassword();
  const { rowCount } = await pgPool().query(
    `update users set password_hash = $2 where lower(email) = lower($1)`,
    [email, await hashPassword(password)],
  );
  if (!rowCount) die(`no user with email ${email}`);
  console.log(`password updated for ${email}`);
}

async function setActive(active: boolean) {
  const email = requireEmail();
  const { rowCount } = await pgPool().query(
    `update users set is_active = $2 where lower(email) = lower($1)`,
    [email, active],
  );
  if (!rowCount) die(`no user with email ${email}`);
  console.log(`${active ? "enabled" : "disabled"} ${email}`);
}

async function main() {
  if (!process.env.DATABASE_URL) die("DATABASE_URL is not set");
  const cmd = process.argv[2];
  switch (cmd) {
    case "create": await create(); break;
    case "list": await list(); break;
    case "passwd": await passwd(); break;
    case "disable": await setActive(false); break;
    case "enable": await setActive(true); break;
    default:
      die(`unknown command "${cmd ?? ""}" — expected create | list | passwd | disable | enable`);
  }
  await pgPool().end();
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
