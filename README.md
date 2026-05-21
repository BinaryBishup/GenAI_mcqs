# MCQ Agent Workflow

An agentic pipeline that **generates** MCQs in the style of a sample batch, **plag-checks** them against the public web, **revamps** flagged ones, and — for code MCQs — **compiles & runs** the snippet to verify the correct answer.

```
┌──────────┐     ┌────────────┐      ┌──────────┐     ┌──────────┐
│ Generator│ →   │Plag Checker│ → →  │ Revamper │ →   │ Verifier │
└──────────┘     └────────────┘  ↑   └──────────┘     └──────────┘
                       ↓         │                          ↓
                   flagged ──────┘                   compile & match
```

All four steps are Claude subagents driven by `claude-agent-sdk`. A FastAPI app
streams progress to a Next.js frontend over SSE so you can watch what's
happening in real time.

## Architecture

```
MCQs/
├── backend/                # Python — agent runtime + API
│   ├── app/
│   │   ├── agents/
│   │   │   ├── generator.py
│   │   │   ├── plag_checker.py
│   │   │   ├── revamper.py
│   │   │   └── verifier.py
│   │   ├── compiler/
│   │   │   └── runner.py   # python3 / node / g++ / javac+java / html
│   │   ├── event_bus.py    # per-session SSE queue
│   │   ├── workflow.py     # orchestrator (gen → plag → revamp → verify)
│   │   ├── schemas.py
│   │   └── main.py         # FastAPI app
│   ├── samples/example.json
│   ├── requirements.txt
│   └── .env.example
├── frontend/               # Next.js 15 + Tailwind + minimal shadcn-style UI
│   ├── app/page.tsx        # single-page experience
│   ├── components/
│   │   ├── ConfigForm.tsx
│   │   ├── WorkflowStream.tsx
│   │   ├── MCQCard.tsx
│   │   └── ui/             # Button, Card, Field
│   └── lib/api.ts          # EventSource subscriber
└── dev.sh                  # one-shot dev runner
```

## Prerequisites

- Python 3.11+
- Node 18+ and npm
- Anthropic API key with access to Sonnet / Opus
- Toolchains for the languages you want code-MCQ verification on:
  - `python3`, `node`, `g++`, `javac` + `java`
  - (the `/api/health` endpoint reports which are present)

## Setup

```bash
# from MCQs/
./dev.sh
```

That script will:

1. Create `backend/.venv` and install Python deps.
2. Copy `backend/.env.example` → `backend/.env` (edit this to add your `ANTHROPIC_API_KEY`).
3. Run `npm install` in `frontend/`.
4. Start `uvicorn` on `:8000` and `next dev` on `:3000`.

Open http://localhost:3000.

### Manual setup

```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env  # then edit
uvicorn app.main:app --reload --port 8000

# in another shell
cd frontend
npm install
npm run dev
```

## How to use

1. Sample workbooks live in `samples/` at the repo root — drop `.xls` files there
   (the project ships with 34 topic files covering C, C#, CSS3, Core/Design-Patterns Java, HTML5, JavaScript, and Python 3).
   The loader parses them on demand and exposes the catalog at `/api/samples/catalog`.
2. In the UI, **pick one or more sample topics**. Filter by language or topic
   name. The "samples per file" control sets how many MCQs from each selected
   file get fed into the generator prompt (default 4).
3. Set a **topic** for the new questions, **count**, **difficulty**, and **type**
   (`general` or `code`). For `code`, pick the **languages**.
4. Optional: under "additional free-form sample text", paste anything extra to
   merge with the loaded samples.
5. **Start workflow** → watch the live event stream → final MCQs render at the bottom.

### Sample .xls schema (legacy Excel)

| Topic | Difficulty Level | Question Text | Answer Choice 1 … 8 | Correct Answer |
|---|---|---|---|---|
| free text | `EASY` / `MEDIUM` / `DIFFICULT` | HTML allowed — code MCQs embed snippets via an `<iframe src="…codesnippet?mode=PYTHON&code=URL_ENCODED_SOURCE">` | up to 8, HTML allowed | `Choice1` … `Choice8` |

The loader strips HTML, URL-decodes the iframe-embedded source, and maps `mode`
to the snippet language (`PYTHON`, `JAVA`, `C`, `CSHARP`, `JAVASCRIPT`, `HTML`, `CSS`).

## What each subagent does

| Role | Where | Job |
|---|---|---|
| generator | orchestrator (`/generate-mcqs`) | Produce N MCQs as JSON, mimicking samples. |
| plag-checker | `mcq-plag-checker` subagent (parallel, haiku) | Search for a distinctive fragment of the question and any code snippet; return `unique` or `flagged`. Budget capped by `quality`: fast=1 search, balanced=2, highest=3. |
| revamper | orchestrator | Rewrite a flagged MCQ — keep the concept and difficulty, change the surface form (numbers, identifiers, scenario). For code MCQs, rewrite the snippet too. |
| verifier | orchestrator (inline bash) | For code MCQs: write the snippet to `runs/<id>/verify/`, run all snippets in parallel via `scripts/run_code.py`, compare stdout to `options[correct_index]`. Reassigns `correct_index` if actual matches another option, or regenerates distractors around the true output. |

## Streamed events

The SSE channel emits one event per workflow step. Useful types:

- `workflow_start`, `phase`, `generated`
- `question_start`, `plag_check`, `plag_unique`, `plag_flagged`, `plag_gave_up`, `revamping`
- `code_verify`, `code_verified`
- `question_done`, `workflow_done`
- `warn`, `error`

## ⚠ Sandboxing

Code is executed **directly on the host** (you chose "no sandbox"). This is
fine for local dev with your own machine, but **never** expose the backend to
the public internet — a flagged MCQ revamp could in principle yield arbitrary
code, and the verifier will run it.

To harden later: swap `backend/app/compiler/runner.py` for a Docker-based runner.

## Configuration

Edit `backend/.env`:

| Key | Default | Notes |
|---|---|---|
| `ANTHROPIC_API_KEY` | — | required |
| `ANTHROPIC_MODEL` | `claude-sonnet-4-6` | any Claude model |
| `BACKEND_PORT` | `8000` | |
| `FRONTEND_ORIGIN` | `http://localhost:3000` | CORS |
| `PYTHON_BIN`/`NODE_BIN`/`JAVAC_BIN`/`JAVA_BIN`/`CPP_BIN` | PATH defaults | pin toolchains |
| `CODE_RUN_TIMEOUT` | `8` | seconds per compile/run step |

## Health check

```bash
curl http://localhost:8000/api/health
```

Returns model, whether the API key is set, and which language toolchains are
discoverable on PATH.
