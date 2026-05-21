# MCQ Workflow — Web (Next.js + Supabase + Vercel)

Generation pipeline for multiple-choice questions:

```
┌──────────┐     ┌────────────────────────┐     ┌──────────┐     ┌──────────┐
│ Generator│ →   │ Plag check             │ → → │ Revamper │ →   │ Verifier │
│ (Claude) │     │ corpus (pg_trgm)       │  ↑  │ (Claude) │     │ (Judge0) │
│          │     │ + Tavily web search    │  │  │          │     │          │
│          │     │ → fuzzball re-rank     │  │  │          │     │          │
└──────────┘     └────────────────────────┘  │  └──────────┘     └──────────┘
                       ↓                     │                          ↓
                   flagged ──────────────────┘                  compile + match
```

- **Generator**: Anthropic Messages API, prompt-cached samples block (`claude-haiku-4-5` / `sonnet-4-6` / `opus-4-7` by quality tier).
- **Plag check**: two parallel signals, both re-ranked with `fuzzball` `token_set_ratio`:
  1. Local corpus via Postgres `pg_trgm` — catches stuff we've scraped.
  2. Web via Tavily — catches stuff that's on the public web but not in the corpus.
  Either signal scoring ≥ `PLAG_FUZZ_THRESHOLD` (default 0.85) flags the MCQ. Tavily is optional; if no key, only the corpus is used.
- **Revamper**: Claude rewrites flagged MCQs in-context.
- **Verifier**: Judge0 (RapidAPI) compiles + runs code MCQs; verdict drives `reassigned_correct_index` / `regenerate_options` fixes.

State lives in Supabase Postgres. The frontend streams progress over SSE.

## Stack

- **Frontend + backend**: Next.js 15 (App Router, TypeScript) — single Vercel deploy.
- **DB**: Supabase Postgres with `pg_trgm`.
- **LLM**: Anthropic Messages API with ephemeral prompt caching.
- **Plag check**: `pg_trgm` + `fuzzball` (rapidfuzz JS port).
- **Code sandbox**: Judge0 CE via RapidAPI.

## Setup

### 1. Supabase

Create a project, then in **Database → Extensions** enable `pg_trgm`. Apply the migrations in `supabase/migrations/` in order (`001_initial.sql`, then `002_drop_embeddings.sql`).

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
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project settings |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase project settings (`sb_publishable_...`) |
| `SUPABASE_SECRET_KEY` | Supabase project settings — optional; falls back to publishable while RLS is off |
| `JUDGE0_RAPIDAPI_KEY` | rapidapi.com/judge0-official/api/judge0-ce |
| `TAVILY_API_KEY` | tavily.com — optional. If missing, plag check uses only the local corpus. |

Optional tuning:

| Key | Default | Notes |
|---|---|---|
| `ANTHROPIC_MODEL_FAST` | `claude-haiku-4-5` | per-quality model override |
| `ANTHROPIC_MODEL_BALANCED` | `claude-sonnet-4-6` | |
| `ANTHROPIC_MODEL_HIGHEST` | `claude-opus-4-7` | |
| `PLAG_FUZZ_THRESHOLD` | `0.85` | token_set_ratio ≥ this flags as plagiarized |

### 3. Seed samples

Imports every `.xls` under `./samples/` into the `samples` table:

```bash
npm run seed:samples
```

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

Check `/api/health` to see which env vars are wired up.

## Deploy to Vercel

1. Push the repo to GitHub.
2. In Vercel → New Project → import the repo. Root Directory stays as `.` (the repo root).
3. Add every key from `.env.example` as a Vercel env var (Production + Preview) — **paste actual values**, not just key names.
4. Deploy.

`app/api/generate/route.ts` sets `export const maxDuration = 300` inline. On Vercel **Hobby** the cap is 60s — generate ≤ 10 MCQs per request on that tier. On **Pro** the cap is 300s — single requests up to ~50 MCQs are fine.

## API

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/health` | env-var sanity check |
| `GET` | `/api/samples` | sample-file catalog |
| `POST` | `/api/generate` | start a run; SSE response streams events |
| `GET` | `/api/runs/{id}` | run + mcqs snapshot |
| `GET` | `/api/runs/{id}/final` | authoritative final MCQ list (SSE-drop fallback) |

### SSE event types

`workflow_start`, `phase`, `generated`, `question_start`, `plag_check`, `plag_unique`, `plag_flagged`, `plag_gave_up`, `revamping`, `code_verify`, `code_verified`, `question_done`, `workflow_done`, `warn`, `error`.

## Schema (high level)

- `samples` — ground-truth MCQs imported from .xls.
- `plag_corpus` — scraped public MCQs (no embeddings, just normalized text).
- `runs` — one row per generation request.
- `mcqs` — generated MCQs with plag + verify state.
- `run_events` — replay log for each SSE event.
- `match_plag_trgm(query_text, match_count, filter_language)` — RPC used by the plag checker.

## What's NOT included in v1

- Auth / multi-tenant — single-user; deploy behind Vercel Password if exposing.
- Long-running background jobs — large batches still go in-band; if you need "click once, get 100 MCQs", upgrade to Vercel Pro for 300s functions or move generation to a Supabase Edge Function + Realtime job queue.
- Sandboxed code execution beyond Judge0's supported languages (csharp/html/css are skipped or partially supported).
- Semantic plag detection — the v1 check only catches exact / near-exact copies. Add a web search fallback (Anthropic's native `web_search_20250305` or Tavily) if you need broader paraphrase coverage.

## Repo layout

```
.
├── app/
│   ├── api/
│   │   ├── generate/route.ts       # POST → SSE stream
│   │   ├── health/route.ts
│   │   ├── runs/[id]/route.ts
│   │   ├── runs/[id]/final/route.ts
│   │   └── samples/route.ts
│   ├── globals.css
│   ├── layout.tsx
│   └── page.tsx
├── components/                     # ConfigDialog, MCQCard, RunView, SamplesList, Timeline + shadcn ui/
├── lib/
│   ├── anthropic.ts                # client + JSON extraction
│   ├── api.ts                      # browser-side fetch helpers
│   ├── env.ts                      # env var accessors
│   ├── judge0.ts                   # code execution
│   ├── plag.ts                     # pg_trgm + fuzzball plag check
│   ├── prompts.ts                  # system + user + revamp prompts
│   ├── runner.ts                   # orchestrator
│   ├── sse.ts                      # SSE helper for Route Handlers
│   ├── supabase.ts                 # service-role client
│   ├── types.ts
│   ├── utils.ts
│   └── verify.ts                   # apply Judge0 verdict
├── samples/                        # legacy .xls workbooks, seeded into Supabase
├── scripts/
│   ├── build-corpus.ts             # scrape plag corpus
│   └── seed-samples.ts             # .xls → samples table
└── supabase/migrations/
    ├── 001_initial.sql
    └── 002_drop_embeddings.sql
```
