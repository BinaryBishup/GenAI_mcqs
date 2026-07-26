# Prompt: Architecture Review & Design of "Assessly" (Gen AI MCQ Platform)

> **Copy everything below this line and paste it into Claude (design/prototype mode).**

---

You are a senior systems architect. Below is the complete, factual architecture of an internal product called **Assessly** ("Gen AI Content — Mercer | Mettl"). I want you to:

1. **Review the architecture** — strengths, weaknesses, risks, scaling limits, security gaps, single points of failure.
2. **Produce clear architecture diagrams** — a high-level system diagram, a request/sequence diagram for the MCQ generation flow, and a data-model (ER) diagram.
3. **Recommend a target architecture** — concrete improvements (with trade-offs) for reliability, security, cost, and scale, prioritized as quick wins vs. long-term.
4. **Build an interactive visual prototype/one-pager** of this architecture that I can share with stakeholders — component boxes, data flows, external service calls, and per-user-action walkthroughs.

Everything below is the ground truth about the current system. Do not invent components that aren't listed.

---

## 1. What the product does

Assessly is an internal web app used by assessment-content teams (Mercer | Mettl) to **generate, quality-check, human-review, finalise, and export multiple-choice questions (MCQs)** using Claude (Anthropic LLMs). Teams upload existing question banks (Mettl Excel format), then generate new questions that match the style of those banks (or create from scratch via a chat wizard). Every generated question passes automated gates (uniqueness, plagiarism, LLM review, independent answer verification) before a human reviews and exports it (Mettl Excel or PDF).

**Users:** 5 internal teams — HACK, Cognitive, Domain, Psychometric, SEG. Multi-tenant by team.

---

## 2. Tech stack

| Layer | Technology |
|---|---|
| Framework | Next.js 15 (App Router), React 19, TypeScript 5.7 |
| Styling | Tailwind CSS v4 + inline styles; Radix UI / shadcn-style primitives |
| AI | Anthropic API via `@anthropic-ai/sdk` (Claude Haiku 4.5 / Sonnet 4.6 / Opus 4.7) |
| Database + Auth | Supabase (Postgres + Supabase Auth); **no RLS** — tenancy enforced in app code |
| Embeddings | Voyage AI (`voyage-3.5`) for semantic dedup |
| Plagiarism / web search | Tavily API + local scraped corpus (Postgres pg_trgm) |
| Excel | `xlsx` library (read Mettl banks, write Mettl bulk-upload .xlsx) |
| PDF | No library — client-side print window (`window.print()`) |
| Fuzzy matching | `fuzzball` (token_set_ratio) |
| Hosting | Vercel (project `gen-ai-mcqs`, prod `gen-ai-mcqs.vercel.app`), all API routes Node.js runtime (no Edge) |

---

## 3. High-level architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Browser (React SPA)                                            │
│  - Single catch-all route app/[[...slug]] renders <AssesslyApp> │
│  - Client-side routing in a React Context store (store.tsx)     │
│  - All data via lib/api.ts: fetch + Bearer JWT + x-assessly-team│
│  - Supabase Auth (publishable key) for login only               │
│  - Exports (Excel/PDF/CSV) happen CLIENT-SIDE                   │
└───────────────┬─────────────────────────────────────────────────┘
                │ HTTPS (REST + SSE)
┌───────────────▼─────────────────────────────────────────────────┐
│  Vercel — Next.js API routes (Node runtime)                     │
│  - Auth: verify JWT via Supabase Admin, resolve team grants     │
│  - /api/generate: SSE stream, maxDuration 800s, after() keepalive│
│  - Orchestrator lib/runner.ts: multi-pass LLM pipeline          │
│  - Daily budget: 750k tokens ≈ 150 questions/team/day           │
└───┬───────────┬───────────┬───────────┬─────────────────────────┘
    │           │           │           │
    ▼           ▼           ▼           ▼
 Anthropic   Supabase     Voyage AI   Tavily
 API         Postgres     embeddings  web search
 (3 model    (service-    (dedup)     (plag check,
 tiers,      role key,                optional)
 streaming,  no RLS)
 prompt
 caching)
```

---

## 4. Frontend architecture

- **One page, client-routed.** `app/[[...slug]]/page.tsx` is an optional catch-all; every URL renders the same `<AssesslyApp/>`. Routing (`/`, `/ongoing`, `/generated`, `/finalised`, `/finalised/[id]`, `/banks/...`, `/generation/[runId]`, `/tag/[id]`, `/create`) is parsed/pushed in a single React Context store (`store.tsx`) with `popstate` handling. No Redux/Zustand.
- **State store (`store.tsx`)** holds: auth session (Supabase `onAuthStateChange` → user + team grants from `user_metadata`), runs list (**polled every 4 s**), bank catalog, tags (optimistic mutations), active team switcher (persisted to `localStorage`), finalised-run overlay (server state ∪ localStorage).
- **Screens:** Pipeline (Dashboard/Ongoing/Generated/Finalised), Banks (+ bank detail, upload modal), Review (human-in-the-loop board), FinalisedRun, Scratch (chat wizard), Tags, Login, SetPassword (forced reset), ExportMenu, GenerateModal.
- **API client (`lib/api.ts`):** every request attaches `Authorization: Bearer <supabase JWT>` + `x-assessly-team` header; shared in-flight session refresh; retry wrapper; SSE reader for generation.

---

## 5. API surface (all Node runtime, all team-scoped via JWT)

| Route | Method | What it does |
|---|---|---|
| `/api/generate` | POST | Auth + daily-budget check → runs the full LLM pipeline, streams progress as SSE. `maxDuration=800s`, `after()` keeps it running if the client disconnects. |
| `/api/runs` | GET | List team's runs (≤100). Also sweeps stale runs (>20 min non-terminal) to `error`. |
| `/api/runs/[id]` | GET | Run row + all its MCQs (used to poll an in-progress run). |
| `/api/runs/[id]/final` | GET | Authoritative final MCQ list (fallback if SSE dropped). |
| `/api/runs/[id]/events` | GET | Stored event log — replays the live generation timeline. |
| `/api/runs/[id]/finalise` | POST | Idempotently stamps `finalised_at`/`finalised_by`. |
| `/api/runs/[id]/review` | POST | Persists one question's human decision (approved/rejected/duplicate/pending + reason). |
| `/api/mcqs` | PATCH | Saves a human-edited MCQ, then **re-runs the LLM answer check** on it. |
| `/api/mcqs/modify` | POST | AI-edits one MCQ from a natural-language instruction (Sonnet). Not persisted until saved. |
| `/api/mcqs/image` | POST | Generates/revises an inline SVG diagram for one MCQ (Sonnet), persists it. |
| `/api/samples` | GET | Team's bank catalog, aggregated per source file (paginates past Supabase's 1000-row cap). |
| `/api/samples/[filename]` | GET / PATCH | Bank contents by difficulty / rename a bank (cascades to tags + runs). |
| `/api/samples/upload` | POST | Parses a Mettl .xls/.xlsx (≤10 MB) and inserts questions. |
| `/api/samples/preview` | POST | Parse-only preview, no DB write. |
| `/api/scratch/interview` | POST | One chat-wizard turn (Sonnet): next question or a finished brief. 60 s. |
| `/api/scratch/samples` | POST | 4 styled sample questions from the brief (Sonnet). 120 s. |
| `/api/scratch/ingest` | POST | Digests an uploaded reference doc (PDF via Haiku; txt/md passthrough). 60 s. |
| `/api/tags`, `/api/tags/[id]`, `/api/tags/[id]/items` | GET/POST/DELETE | Tag CRUD + attach/detach runs & banks. |
| `/api/health` | GET | Reports which env keys are configured + model IDs. |

---

## 6. Data model (Supabase Postgres — no RLS)

- **`samples`** — imported bank questions: `source_file`, `topic`, `difficulty` (easy/medium/hard), `type` (general/code), `language`, `question`, `options` (jsonb), `correct_index`, `code`, `team`, `uploaded_by`. Trigram index on topic.
- **`runs`** — one per generation job: `status` (pending → generating → plagchecking → reviewing → verifying → done | error), `topic`, `difficulty`, `mcq_type`, `count`, `quality`, `languages`, `sample_file_ids`, `mode`, `grounded`, `question_kinds`, `created_by`, `created_by_name`, `finalised_at`, `finalised_by`, timestamps.
- **`mcqs`** — generated questions (unique per `run_id`+`index`): question/options/correct_index/explanation, code snippet fields, `plag_status`+`plag_matches`, `answer_check_status/index/notes`, `parent_sample_id` (seed lineage), `diversity_status`, `image_svg`, `review_status`/`review_reason`/`reviewed_by`/`reviewed_at`.
- **`run_events`** — append-only event log per run (powers SSE replay + the review screen's process tracker).
- **`plag_corpus`** — scraped public MCQs with `pg_trgm` index + a `match_plag_trgm()` SQL function.
- **`tags`** / **`tag_items`** — team-scoped labels attaching to runs or banks (polymorphic `item_type` + `item_id`).

**Tenancy:** every query filters `.eq("team", team)` in application code. The server always uses the **service-role key**; there is **no RLS** and no DB-level tenant isolation.

---

## 7. What happens on each user action (end-to-end flows)

### 7.1 Login
Browser → Supabase Auth directly (`signInWithPassword`, publishable key). Session JWT stored in localStorage. Team grants live in `user_metadata` (`team`/`teams`, `"ALL"` = every team). If `must_reset_password` is set, a forced SetPassword screen calls `auth.updateUser`. Server-side, every API route verifies the Bearer JWT via the Supabase Admin API and validates the requested `x-assessly-team` against the user's grants. User provisioning is out-of-band (admin script with service key).

### 7.2 Generate MCQs (the core flow — many outbound LLM calls)
1. User configures a run in GenerateModal (topic, count, difficulty, type, quality tier, source banks) → `POST /api/generate` (SSE).
2. Server: auth check → **daily budget check** (750,000 tokens/day/team ÷ ~5,000 tokens/question ≈ 150 questions/day) → inserts a `runs` row → streams `workflow_start`.
3. **Seed planning:** if generating from banks, load the bank's questions, order them by diversity (**Voyage embeddings** + farthest-point sampling), and allocate per-seed variants ("item cloning"). Otherwise build a blended few-shot block. Per-team style guidance is injected into the prompt.
4. **Generation pass:** questions produced in token-safe batches (6 code / 12 general per call) at **concurrency 5**, each a **streaming** Anthropic call (`messages.stream`) with the system prompt **prompt-cached** (`cache_control: ephemeral`). Model = user's quality tier: fast → Haiku 4.5, balanced → Sonnet 4.6, highest → Opus 4.7. `max_tokens` 16,000/batch. One retry on JSON parse failure. Drafts persisted to `mcqs`; correct-answer position randomized.
5. **Uniqueness/plagiarism pass** (`status: plagchecking`): per-question **Voyage cosine similarity** vs. sibling questions and source bank (thresholds 0.88 / 0.93, lexical fallback), plus plagiarism probe against the local scraped corpus (pg_trgm + fuzzball rerank, flag ≥ 0.85) and optionally **Tavily web search**. Failing questions are regenerated from their seed up to 2 times, else flagged.
6. **LLM review pass** (`status: reviewing`): questions sent in chunks of 8 to the same model with a reviewer system prompt → verdicts pass / fix (applied in place) / reject. Rejects are regenerated once and re-reviewed.
7. **Answer-verification pass** (`status: verifying`): a **stronger model (Opus)** blind-solves each non-code question with no access to the claimed key. Confident disagreements go to an **arbiter call** (Opus) that can correct the answer key or flag the question as ambiguous; ambiguous items get one seed-regeneration attempt.
8. **Diagram pass** (optional): Claude decides-and-draws one self-contained inline SVG per question that needs a visual, concurrency 4, best-effort.
9. `status: done`, `workflow_done` streamed. **Every event is also written to `run_events`**, and Vercel's `after()` keeps the function alive to finish even if the user closes the tab. Client polls `/api/runs` every 4 s as a backstop.

**Outbound calls per run of N questions (approx.):** N/6–N/12 generation calls + N embedding calls (Voyage) + N/8 review calls + N verify calls + arbiter/regen/diagram extras. All Anthropic traffic goes through one lazily-initialized SDK client.

### 7.3 Human review
Review board loads the run + replayed `run_events`. Cards default to approved unless a gate flagged them. Per card the reviewer can: approve / reject / mark too-similar (→ `POST /api/runs/[id]/review`), hand-edit (→ `PATCH /api/mcqs`, which **re-runs the LLM answer check** on the edited question), AI-edit with an instruction (→ `POST /api/mcqs/modify`, Sonnet), or regenerate the diagram (→ `POST /api/mcqs/image`, Sonnet).

### 7.4 Finalise
`POST /api/runs/[id]/finalise` idempotently stamps `finalised_at`/`finalised_by`; the client also keeps a localStorage overlay so the UI updates optimistically.

### 7.5 Export
**Entirely client-side.** ExportMenu fetches the run's MCQs then either builds the **Mettl bulk-upload .xlsx** in the browser (`xlsx` lib, 14-column format, hard → "Difficult", code embedded via Mettl codesnippet iframe) or opens a styled print window for **PDF (with/without answers)**. JSON/CSV also supported. Flagged/unusable questions excluded by default. No export traffic touches the server.

### 7.6 Create-from-scratch (chat wizard)
Optional doc upload → `/api/scratch/ingest` (Haiku digests a PDF into a brief-sized digest) → iterative interview turns → `/api/scratch/interview` (Sonnet asks one question per turn until the brief is complete) → `/api/scratch/samples` (Sonnet drafts 4 styled exemplar questions) → author picks exemplars → the normal generate pipeline runs with `mode: "scratch"` and the approved exemplars injected as style guidance.

### 7.7 Bank upload
Browser posts the Mettl workbook (≤10 MB) → server parses with `xlsx`, previews grouped by difficulty, then inserts into `samples` stamped with team + uploader.

---

## 8. Outbound/external services inventory

| Service | Used for | Auth | Notes |
|---|---|---|---|
| Anthropic API | All LLM work: generation (streamed, prompt-cached), review, answer verify, arbiter, diagrams, scratch wizard, AI-edit | `ANTHROPIC_API_KEY` | 3 model tiers (Haiku 4.5 / Sonnet 4.6 / Opus 4.7) selected per task; verify/arbiter always use the highest tier |
| Supabase | Postgres (all tables) + Auth | Service-role key (server), publishable key (browser, auth only) | No RLS; app-level tenancy |
| Voyage AI | `voyage-3.5` embeddings for semantic dedup + seed diversity ordering | `VOYAGE_API_KEY` | Raw fetch, no SDK |
| Tavily | Web plagiarism probe (optional) | `TAVILY_API_KEY` | Skipped if key absent |
| Judge0 (RapidAPI) | Code-execution sandbox | `JUDGE0_RAPIDAPI_KEY` | **Present in code but not wired into the current pipeline** (vestigial, like the old grounding module) |
| Vercel | Hosting; `after()` keep-alive; 800 s function ceiling on generate | — | All routes Node runtime |
| Claude Code CLI (local subprocess) | **Dev-only** fallback when the API key fails locally | — | Never runs in production |

---

## 9. Security & operational model (be critical here)

- JWT verified server-side on every route; `team`/`created_by` stamped server-side (client can't spoof).
- **No RLS** — a single application-code bug (`.eq("team", …)` missed) leaks cross-tenant data; the service-role key is the only DB credential the server uses.
- Rate limiting = daily token budget only (150 questions/team/day); no per-request rate limit.
- Long-running generation lives inside one 800 s serverless function; no queue, no resumability if the function dies mid-run (stale runs swept to `error` after 20 min).
- Client polls runs every 4 s (no websockets/realtime).
- Exports are client-side, so exported files never hit server logs — but also can't be audited server-side.
- Env config: Anthropic key + model overrides, Supabase URL/keys, Voyage, Tavily, Judge0, similarity/plag thresholds.

---

## 10. What I want from you (deliverables)

1. **Architecture review** covering at minimum: the no-RLS multi-tenancy risk, the 800 s single-function pipeline (vs. a queue/worker design), the 4 s polling pattern, client-side export trade-offs, LLM cost structure and where prompt caching / model-tier choices help or hurt, failure modes (SSE drop, function timeout, partial runs), and the vestigial modules (Judge0, grounding) — keep or remove.
2. **Diagrams:** (a) system context/container diagram, (b) sequence diagram of the generate flow (§7.2) showing every outbound call, (c) ER diagram of §6.
3. **Target-state proposal:** prioritized recommendations with effort/impact, plus a migration path that doesn't require a rewrite.
4. **A polished, shareable visual one-pager/prototype** of the architecture (current state + proposed state) suitable for a stakeholder review.
