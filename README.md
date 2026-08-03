# SmartCoGen — MCQ Workflow (Next.js + Postgres)

Generation pipeline for multiple-choice questions:

```
┌──────────┐     ┌────────────────────────┐     ┌──────────┐     ┌──────────┐
│ Generator│ →   │ Plag check             │ → → │ Reviewer │ →   │ Verifier │
│ (Claude) │     │ corpus (pg_trgm)       │  ↑  │ (Claude) │     │ (Claude) │
│          │     │ + Tavily web search    │  │  │          │     │          │
│          │     │ → fuzzball re-rank     │  │  │          │     │          │
└──────────┘     └────────────────────────┘  │  └──────────┘     └──────────┘
                       ↓                     │                          ↓
                   flagged ──────────────────┘              blind solve + arbitrate
```

- **Generator**: Anthropic Messages API, prompt-cached samples block (`claude-haiku-4-5` / `sonnet-4-6` / `opus-4-7` by quality tier).
- **Plag check**: two parallel signals, both re-ranked with `fuzzball` `token_set_ratio`:
  1. Local corpus via Postgres `pg_trgm` — catches stuff we've scraped.
  2. Web via Tavily — catches stuff that's on the public web but not in the corpus.
  Either signal scoring ≥ `PLAG_FUZZ_THRESHOLD` (default 0.85) flags the MCQ. Tavily is optional; if no key, only the corpus is used.
- **Reviewer**: Claude rewrites flagged MCQs in-context and audits correctness, concept-match and difficulty.
- **Verifier**: the highest-tier model solves each question blind, then `arbitrate()` reconciles its answer with the recorded key — it can correct the key outright.

All state lives in one Postgres database. The frontend streams progress over SSE.

## Stack

- **Frontend + backend**: Next.js 15 (App Router, TypeScript), served by `next start` behind nginx.
- **Runtime**: Node 24 LTS (floor: Node 22 — Node 20 reached end-of-life in April 2026). `.nvmrc` pins the canonical version.
- **DB**: Postgres 13+ with `pg_trgm` (RDS in production, any local Postgres in dev). Accessed directly via `node-postgres` — no ORM, no data-API layer.
- **Auth**: self-hosted. Accounts live in the `users` table, passwords are bcrypt hashes, sessions are HS256 JWTs in an httpOnly cookie. No external identity provider.
- **LLM**: Anthropic Messages API with ephemeral prompt caching.
- **Plag check**: `pg_trgm` + `fuzzball` (rapidfuzz JS port).

There are no other runtime dependencies — given a Postgres endpoint and an Anthropic key, the app runs entirely inside a VPC.

## Setup

### 1. Database

Create an empty database and apply the schema:

```bash
createdb smartcogen                      # or provision an RDS instance
export DATABASE_URL=postgres://postgres:postgres@localhost:5432/smartcogen
npm run db:schema                      # psql "$DATABASE_URL" -f deploy/schema.sql
```

`deploy/schema.sql` creates every table and enables `pg_trgm`. To upgrade a database that predates self-hosted auth, apply `deploy/migrations/001_local_auth.sql` instead.

### 2. Local env

```bash
cp .env.example .env.local
# edit .env.local with your keys
npm install
```

`.env.local` keys:

| Key | Source |
|---|---|
| `ANTHROPIC_API_KEY` | console.anthropic.com |
| `DATABASE_URL` | your Postgres connection string |
| `DATABASE_SSL` | set to `disable` for a local Postgres; omit for RDS (TLS required) |
| `AUTH_JWT_SECRET` | generate with `openssl rand -base64 48` — min 32 chars |
| `TAVILY_API_KEY` | tavily.com — optional. If missing, plag check uses only the local corpus. |

Optional tuning:

| Key | Default | Notes |
|---|---|---|
| `ANTHROPIC_MODEL_FAST` | `claude-haiku-4-5` | per-quality model override |
| `ANTHROPIC_MODEL_BALANCED` | `claude-sonnet-4-6` | |
| `ANTHROPIC_MODEL_HIGHEST` | `claude-opus-4-7` | |
| `AUTH_SESSION_TTL_HOURS` | `168` | session lifetime before re-login |
| `DATABASE_POOL_MAX` | `10` | node-postgres pool size |
| `PLAG_FUZZ_THRESHOLD` | `0.85` | token_set_ratio ≥ this flags as plagiarized |

### 3. Create your first account

There is no self-signup. Accounts are provisioned from the CLI:

```bash
npm run user:create -- --email you@company.com --password 'choose-a-password' --name "Your Name" --team ALL
```

You choose the password explicitly — nothing is generated and nothing is temporary. See [Account administration](#account-administration) for the rest of the commands.

### 4. Build plag corpus (one-time)

Scrapes Sanfoundry (extend `SCRAPERS` in `scripts/build-corpus.ts` to add more sources) and inserts normalized question text into `plag_corpus`. No paid API calls — just scraping + Postgres inserts.

```bash
npm run build:corpus
```

### 5. Run dev server

```bash
npm run dev
# open http://localhost:3000
```

Check `/api/health` to see whether Postgres is reachable and which env vars are wired up.

## Deploy

See [DEPLOYMENT.md](DEPLOYMENT.md) for the EC2 + RDS runbook (`deploy/setup-server.sh` once, `deploy/deploy.sh user@host` thereafter).

## Account administration

| Command | Purpose |
|---|---|
| `npm run user:create -- --email a@b.com --password 'x' --name "A B" --team HACK [--teams SEG,Domain]` | provision an account |
| `npm run user:list` | list accounts, team grants and last login |
| `npm run user:passwd -- --email a@b.com --password 'x'` | set a user's password |
| `npm run user:disable -- --email a@b.com` | revoke access without deleting the row |
| `npm run user:enable -- --email a@b.com` | restore access |

`--team` is the primary grant and accepts `ALL` to see every team. `--teams` adds extra teams beyond the primary one. `--password` is always explicit and must be at least 8 characters — the CLI never generates or emails one.

An account is only an email and a password. There is no self-signup, no "forgot password" flow, no bootstrap/temporary password and no in-app password change: if someone is locked out, an admin sets a new password with `user:passwd`.

## API

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/health` | env + database reachability check |
| `POST` | `/api/auth/login` | sign in; sets the session cookie |
| `POST` | `/api/auth/logout` | clear the session cookie |
| `GET` | `/api/auth/me` | current user, or 401 |
| `GET` | `/api/samples` | sample-file catalog |
| `POST` | `/api/generate` | start a run; SSE response streams events |
| `GET` | `/api/runs/{id}` | run + mcqs snapshot |
| `GET` | `/api/runs/{id}/final` | authoritative final MCQ list (SSE-drop fallback) |

Every route except `/api/health` and `/api/auth/login` requires the session cookie. The optional `x-smartcogen-team` header selects which of the user's team grants a request is scoped to; the server validates it against the grants in the signed cookie, so it can select among them but never escalate.

### SSE event types

`workflow_start`, `phase`, `generated`, `question_start`, `plag_check`, `plag_unique`, `plag_flagged`, `plag_gave_up`, `revamping`, `question_done`, `workflow_done`, `warn`, `error`.

Run statuses: `pending` → `generating` → `plagchecking` → `reviewing` → `verifying` → `done` (or `error`). `revamping` is emitted as an event during regeneration but is not a resting status.

## Schema (high level)

- `users` — accounts, bcrypt password hashes and team grants.
- `samples` — ground-truth MCQs imported from .xls.
- `plag_corpus` — scraped public MCQs (no embeddings, just normalized text).
- `runs` — one row per generation request.
- `mcqs` — generated MCQs with plag + verify state.
- `run_events` — replay log for each SSE event.
- `tags` / `tag_items` — user-defined groupings over banks and runs.
- `match_plag_trgm(query_text, match_count, filter_language)` — RPC used by the plag checker.

## Known limits

- Sessions are stateless JWTs: signing out clears the cookie but does not invalidate an already-issued token before its TTL. Disabling a user takes effect on their next `/api/auth/me` (page load), not mid-session. Rotate `AUTH_JWT_SECRET` to force-expire every session at once.
- No self-service password change or reset of any kind — an admin sets passwords with `npm run user:passwd`.
- Login is not rate-limited in the app; put a rate limit on nginx or the load balancer if the app is internet-facing.
- Long-running background jobs — large batches still go in-band. `after()` keeps a run alive past client disconnect, but a process restart mid-run marks it stale after 20 minutes.
- Semantic plag detection — the check only catches exact / near-exact copies, not paraphrase.

## Repo layout

```
.
├── app/
│   ├── api/
│   │   ├── auth/                   # login, logout, me, password
│   │   ├── generate/route.ts       # POST → SSE stream
│   │   ├── health/route.ts
│   │   ├── runs/…                  # run snapshot, events, review, finalise
│   │   ├── samples/…               # catalog, preview, upload, rename
│   │   ├── scratch/…               # from-scratch interview + sample generation
│   │   └── tags/…
│   ├── [[...slug]]/page.tsx        # the single-page workspace shell
│   ├── globals.css
│   └── layout.tsx
├── components/
│   ├── smartcogen/                   # workspace UI: store, topbar, sidebar, modals
│   │   └── screens/                # banks, review, scratch, pipeline, faqs
│   └── ui/                         # shadcn primitives
├── lib/
│   ├── server/                     # server-only infrastructure
│   │   ├── db.ts                   # node-postgres pool + query builder
│   │   ├── auth.ts                 # bcrypt hashing, JWT sign/verify, session cookie
│   │   └── team.ts                 # per-request team scoping
│   ├── ai/                         # model + search access and prompt construction
│   │   ├── anthropic.ts            # client + JSON extraction
│   │   ├── claude-cli.ts           # dev fallback via the Claude Code CLI
│   │   ├── prompts.ts              # generation, review and revamp prompts
│   │   ├── answer-check.ts         # independent key re-derivation
│   │   ├── diagram.ts              # inline-SVG diagram generation
│   │   ├── scratch.ts              # from-scratch interview prompts
│   │   ├── embed.ts                # Voyage embeddings
│   │   └── tavily.ts               # web search
│   ├── pipeline/                   # the generation workflow
│   │   ├── runner.ts               # orchestrator
│   │   ├── seed-plan.ts            # seed selection + diverse ordering
│   │   ├── plag.ts                 # pg_trgm + fuzzball plag check
│   │   ├── limits.ts               # per-team daily budget
│   │   └── sse.ts                  # SSE helper for Route Handlers
│   ├── banks/
│   │   ├── xls-parse.ts            # legacy .xls bank → sample rows
│   │   └── sample-source.ts        # source_file naming
│   ├── export/                     # csv, pdf and Mettl output formats
│   ├── api.ts                      # browser-side fetch helpers
│   ├── env.ts                      # env var accessors
│   ├── types.ts
│   └── utils.ts                    # client-safe helpers (isUsable, cn)
├── deploy/
│   ├── schema.sql                  # full schema for a fresh database
│   ├── migrations/                 # in-place upgrades for existing databases
│   ├── setup-server.sh             # one-time EC2 provisioning
│   ├── deploy.sh                   # rsync + build + pm2 restart
│   └── nginx.conf
└── scripts/
    ├── build-corpus.ts             # scrape plag corpus
    └── user.ts                     # account administration CLI
```

Import convention: everything under `lib/` is imported through the `@/lib/...`
alias, including from other `lib/` modules — no relative hops between folders.
`scripts/` uses relative paths so `tsx` needs no alias resolution.
