"use client";

// FAQs & Help — a static, product-team-authored guide to using the app.
// Grouped accordion; no backend involved.

import { useState } from "react";
import { C } from "../theme";
import { HBox } from "../ui";
import { IconChevUp } from "../icons";

type QA = { q: string; a: React.ReactNode };
type Section = { heading: string; items: QA[] };

const SECTIONS: Section[] = [
  {
    heading: "Getting started",
    items: [
      {
        q: "What does this product do?",
        a: "It generates assessment-ready MCQs with AI, end to end: you describe what you need (or point it at an existing question bank), it drafts the questions, checks them for plagiarism and repeats, verifies every answer key independently, and hands you a set to review, finalise, and export to Mettl or PDF.",
      },
      {
        q: "What are the two ways to create questions?",
        a: (
          <>
            <b>Create from scratch</b> — describe the topic in plain language, answer a couple of AI follow-ups, approve the style samples it proposes, and it generates the full set. Use this when you have no existing bank.
            <br />
            <br />
            <b>Generate Questions (from banks)</b> — pick one of your uploaded question banks, choose difficulty and count, and it generates fresh questions in the same style as the bank&apos;s samples. Use this when the client has shared sample questions.
          </>
        ),
      },
      {
        q: "Which button do I press first?",
        a: "Both live in the top-right of every screen: “Create from scratch” opens the guided wizard; “Generate Questions” opens the bank picker. If you have client sample files, upload them first under Question Banks → Upload bank.",
      },
    ],
  },
  {
    heading: "Creating from scratch",
    items: [
      {
        q: "What should I write in the description?",
        a: "One or two plain sentences: the topic, who it's for, and anything that matters — e.g. “SQL joins, indexing and query optimisation for backend engineer hiring”. You don't need to write a prompt; the AI interviews you for the rest.",
      },
      {
        q: "Can I attach a syllabus or client documents?",
        a: "Yes — the “Attach syllabus or notes” button accepts PDF, Word (.docx/.doc), Excel (.xlsx/.xls), CSV, and text files. The content is read and used as grounding for the questions. The file itself is not stored — only its extracted text, and only on generations you actually launch.",
      },
      {
        q: "Why does it ask me follow-up questions?",
        a: "The follow-ups sharpen the brief — subtopics to emphasise, whether to use code snippets, whether diagrams help. Better answers here mean fewer rejected questions later. Every question has chips you can click, or type your own answer.",
      },
      {
        q: "What are the sample questions it shows before generating?",
        a: "They're style exemplars. Pick the ones that look right and the full set is generated to match their tone, length, and format. Think of it as choosing the template for the whole batch.",
      },
    ],
  },
  {
    heading: "Working with question banks",
    items: [
      {
        q: "What file formats can I upload as a bank?",
        a: "Excel (.xls/.xlsx) and CSV in the standard question format (question, options, correct answer, difficulty). After upload the bank appears under Question Banks with per-difficulty counts.",
      },
      {
        q: "How does generation from a bank work?",
        a: "Each generated question is seeded from a real sample in your bank: the AI studies the sample's concept, style, and length, then writes a brand-new question in that mould. Seeds are spread across the bank's distinct concepts so the output covers the bank, not just its first few rows.",
      },
      {
        q: "Why can't I pick “hard” questions from some banks?",
        a: "A bank only offers the difficulties it actually contains. If a bank has only easy questions, the difficulty buttons show that — this prevents the AI from guessing what “hard” means for a bank that never defined it.",
      },
    ],
  },
  {
    heading: "Quality: plagiarism, verification & review",
    items: [
      {
        q: "How is plagiarism checked?",
        a: "Every generated question is checked four ways: against your internal question banks, against the sample batch it was seeded from, against the other questions in the same set (no near-duplicates), and against external web sources. Flagged questions are regenerated automatically before you ever see them.",
      },
      {
        q: "How do I know the answer key is right?",
        a: "A second, stronger AI model solves every question blind — without seeing the intended answer — and an arbiter compares the two. Disagreements are corrected or sent back. You can still override anything during review.",
      },
      {
        q: "What am I expected to do in the review screen?",
        a: "Read each question, then Approve, Edit (by hand or with AI), or Reject it. Rejections require a reason — those reasons are collected to improve future generations. When you're happy, “Finalise to bank” locks the approved set.",
      },
      {
        q: "What does “Too similar” mean?",
        a: "It flags the question as overlapping another one in the set. Use it when two questions test the identical fact in near-identical words — the set is stronger when every question earns its place.",
      },
    ],
  },
  {
    heading: "Exporting & sharing",
    items: [
      {
        q: "How do I export a finalised set?",
        a: "Open the set (Generated Sets or Finalised Banks) and use Export. You can download a Mettl bulk-upload spreadsheet (.xlsx) ready for the platform, or a PDF — with or without the answer key.",
      },
      {
        q: "Where do finalised questions live?",
        a: "In your team's Finalised Banks. Every question keeps its lineage — which bank and sample it was seeded from, who created and finalised it, and any review edits.",
      },
    ],
  },
  {
    heading: "Teams, limits & troubleshooting",
    items: [
      {
        q: "Who can see my generations?",
        a: "Everything is team-scoped: your team sees your team's banks, generations, and finalised sets — no one else's. If you belong to multiple teams, switch the active team from your profile card at the bottom of the sidebar.",
      },
      {
        q: "Is there a limit on how much I can generate?",
        a: "Each team has a daily generation budget (the meter at the bottom of the sidebar). If you hit it, generation pauses until the next day — finalising, reviewing, and exporting are never blocked.",
      },
      {
        q: "A generation failed or got stuck — what do I do?",
        a: "Open it from Ongoing Generations to see the stage it stopped at. Transient failures usually succeed on a fresh run with the same settings. If a run repeatedly fails, note the run ID and the settings you used and pass them to the product team.",
      },
    ],
  },
];

function QARow({ qa }: { qa: QA }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ borderBottom: `1px solid ${C.rowLine}` }}>
      <HBox
        onClick={() => setOpen(!open)}
        style={{ display: "flex", alignItems: "center", gap: 12, padding: "15px 18px", cursor: "pointer" }}
        hover={{ background: C.panel }}
      >
        <span style={{ flex: 1, fontSize: 15, fontWeight: 700, color: C.navy }}>{qa.q}</span>
        <span style={{ display: "inline-flex", color: C.muted, transform: open ? "none" : "rotate(180deg)", transition: "transform .15s" }}>
          <IconChevUp s={16} />
        </span>
      </HBox>
      {open && (
        <div style={{ padding: "0 18px 16px", fontSize: 14.5, lineHeight: 1.65, color: C.slate, maxWidth: 860 }}>{qa.a}</div>
      )}
    </div>
  );
}

export function Faqs() {
  return (
    <div style={{ maxWidth: 980, margin: "0 auto" }}>
      {SECTIONS.map((s) => (
        <div key={s.heading} style={{ marginBottom: 26 }}>
          <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: 1, color: C.muted, textTransform: "uppercase", padding: "0 4px 9px" }}>
            {s.heading}
          </div>
          <div style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 14, overflow: "hidden" }}>
            {s.items.map((qa) => (
              <QARow key={qa.q} qa={qa} />
            ))}
          </div>
        </div>
      ))}

      <div style={{ padding: "6px 4px 30px", fontSize: 14, color: C.muted }}>
        Didn&apos;t find your answer? Reach out to the product team.
      </div>
    </div>
  );
}
