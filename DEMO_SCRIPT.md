# CEO Demo Script — Gen AI Content (Assessly)

**Announcement demo · features only, no metrics yet · ~8 minutes · one browser tab**

---

## The one-liner (open with this)

> "This is our internal AI content studio: it interviews the test author instead of making them write prompts, generates exam-grade questions in our house style, quality-checks its own work with a second, stronger AI — and keeps a human as the final editor. Authoring a question bank goes from days to minutes."

---

## Feature walkthrough (in showcase order)

### 1. Create from scratch — the guided wizard ⭐ lead with this
Click **Create from scratch** (available from every page).
- **Describe** — the author writes one plain sentence. No prompt engineering, ever.
- **Attach anything a client sends** — Word, Excel, PDF, CSV, text. The AI reads it, extracts the testable content, and the document is **saved to the team library** for reuse in future sets.
- **Audience** — Campus (Tier 1–4) or Lateral (experience bands), difficulty, count. Two clicks.
- **Follow-up** — the AI asks only what's still missing, and its suggestions are *specific to the topic you typed* (fintech topic → fraud-detection subtopics; Java topic → code-language options). This is the "it actually understood me" moment.
- **Brief** — the AI plays back its understanding in plain words; the author can adjust by typing "make it 20 questions".
- **Samples first, commitment later** — 4 genuinely different question styles; the author picks their taste and the full set is built in those styles. "Different varieties" regenerates fresh styles.

### 2. The self-checking pipeline (show Ongoing's live progress)
Say it as three gates:
- **Uniqueness gate** — every generated question is compared against the *entire* source bank and the public web; near-duplicates are regenerated automatically.
- **Editor gate** — an AI reviewer grades correctness, distractor quality, and style match against the bank, and rewrites weak options.
- **Verifier gate** — a *stronger* AI model blind-solves every question without seeing the claimed answer; disagreements go to an AI arbiter. Wrong answer keys get caught before any human sees them.

> Key line: "The AI doesn't just write — it disagrees with itself on purpose."

### 3. Human in charge — the review board
Open a finished set:
- Approve, reject, or **edit with AI** ("make option B more tempting") per question
- **Full provenance**: click "Cloned from source question" on any card to see the exact bank question it was modelled on — auditable lineage for clients
- Diagrams: questions that benefit from a visual get an AI-drawn diagram, editable on the spot

### 4. Bank-based generation (the second entry point)
From Question Banks: pick an existing client bank → the AI clones its style question-by-question. Existing content becomes a style guide, not a ceiling.

### 5. One-click delivery
Finalise → export **Mettl-ready Excel** (bulk-upload format) or **PDF** with/without answer keys. No re-formatting step.

### 6. Built for teams
Five team workspaces, each with its own banks, documents, tags, and review flow. Everyone's work is attributed; nothing leaks across teams.

---

## The roadmap close (what "announce now, measure next" looks like)

1. **Feedback collection** — structured reviewer feedback on every approve/reject/edit, so the generator learns each team's taste and quality bar over time
2. **Measured impact** — the pipeline already logs every decision; a quality & ROI dashboard switches on once we have a few weeks of organic usage
3. **Client self-serve** — the same wizard, white-labelled, in front of clients
4. **Code-execution verification** for programming questions; more question formats (multi-correct, numeric)

---

## Pre-demo checklist

- [ ] Server running, logged in, one finished bank-based run open in a second tab (for the lineage click)
- [ ] A client-style .docx or .xlsx on the desktop for the attach moment
- [ ] Anthropic API credits topped up
- [ ] One full dry run of the wizard tonight (~30s of total AI wait across the flow)
- [ ] If demoing on prod: update `ANTHROPIC_MODEL_BALANCED=claude-sonnet-5` in Vercel env + redeploy, or demo on localhost
