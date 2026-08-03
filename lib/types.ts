export type Language = "python" | "java" | "cpp" | "c" | "csharp" | "javascript" | "html" | "css";
export type MCQType = "general" | "code";
export type Difficulty = "easy" | "medium" | "hard";
export type Quality = "fast" | "balanced" | "highest";
export type PlagStatus = "pending" | "unique" | "flagged" | "revamped" | "gave_up";
// Resting statuses a run row moves through, in pipeline order:
//   generating → plagchecking → reviewing → verifying → done | error
// "revamping" is only ever an event type during regeneration, never persisted
// as a status; it stays in the union so historical rows still type-check.
export type RunStatus = "pending" | "generating" | "reviewing" | "plagchecking" | "revamping" | "verifying" | "done" | "error";

/** The working teams; a profile belongs to one, and may be granted visibility into more. */
export type Team = "HACK" | "Cognitive" | "Domain" | "Psychometric" | "SEG";
export const TEAMS: Team[] = ["HACK", "Cognitive", "Domain", "Psychometric", "SEG"];

/** Auth-metadata team value: a working team, or "ALL" (visibility into every team). */
export type TeamMeta = Team | "ALL";

export interface Profile {
  id: string;
  full_name: string | null;
  team: Team;
}

/** Independent (non-code) correctness check verdict. */
export type AnswerCheckStatus = "pending" | "agree" | "disagree" | "uncertain" | "skipped";

/**
 * The two fundamental MCQ types (see the question-type taxonomy in prompts.ts).
 *   application → use knowledge to perform/implement; ONE direct correct answer
 *                 (which query/command, what will this code return, how to implement)
 *   analysis    → reason about behaviour/consequences/relationships/best practices;
 *                 several plausible distractors (why is X preferred, what happens if…,
 *                 which approach is most appropriate and why, find the root cause)
 * Code / SQL is a *vehicle* that can appear in either type — controlled separately
 * by mcq_type ("code") + languages, not by this enum.
 */
export type QuestionKind = "application" | "analysis";

export interface CodeSnippet {
  language: Language;
  code: string;
  stdin?: string | null;
}

export interface MCQ {
  id: string;
  type: MCQType;
  topic: string;
  difficulty: Difficulty;
  question: string;
  options: string[];
  correct_index: number;
  explanation?: string | null;
  snippet?: CodeSnippet | null;
  plag_status?: PlagStatus;
  plag_matches?: string[];
  plag_attempts?: number;
  /** Independent re-derivation of the answer for non-code MCQs. */
  answer_check_status?: AnswerCheckStatus;
  /** Option index the independent checker believed correct (for disagree). */
  answer_check_index?: number | null;
  /** One-line rationale from the checker. */
  answer_check_notes?: string | null;
  /** Sample row id this MCQ was cloned from (per-seed expansion). Null = scratch/blend. */
  parent_sample_id?: string | null;
  /** The original bank question this MCQ was cloned from (resolved server-side). */
  source_sample?: {
    question: string;
    options: string[];
    correct_index: number;
    source_file: string;
    difficulty: string;
  } | null;
  /** Sibling-diversity verdict for seeded variants: 'ok' or 'duplicate' (too similar, couldn't fix). */
  diversity_status?: "ok" | "duplicate";
  /** Inline SVG diagram (diagram-as-code), when the question needs a visual. */
  image_svg?: string | null;
  /** Server-persisted reviewer decision (pending/approved/rejected/duplicate). */
  review_status?: string | null;
  /** Reviewer's reject/duplicate note. */
  review_reason?: string | null;
}

export interface GenerateRequest {
  count: number;
  topic: string;
  /** Owning team — the run (and its questions) are scoped to it. */
  team?: Team;
  /** Who started the run — set server-side from the verified JWT, never by the client. */
  created_by?: string | null;
  created_by_name?: string | null;
  difficulty: Difficulty;
  mcq_type: MCQType;
  languages: Language[];
  samples: MCQ[];
  samples_raw?: string;
  sample_files: string[];
  samples_per_file: number;
  max_revamp_attempts: number;
  quality: Quality;
  /** Appended to the standard user prompt as "Additional instructions". */
  extra_prompt?: string;
  /** Appended as an "Avoid:" block in the prompt. */
  negative_prompt?: string;
  /** Subset of quality-rule IDs to apply. Omit / undefined = all rules on. */
  quality_rules?: string[];
  /**
   * Fetch reference text from the web (Tavily) and require the model to ground
   * factual claims in it. Defaults to true. Set false to skip the extra search.
   */
  grounding?: boolean;
  /**
   * Per-bank generation specs (sample mode). Each bank contributes `count`
   * questions at `difficulty`, seeded ONLY from that bank's `difficulty`
   * questions — so a "medium" request never draws easy/hard samples.
   */
  bank_specs?: BankSpec[];
  /** Generate inline SVG diagrams (diagram-as-code) for questions that need a visual. */
  create_images?: boolean;
  /** 'sample' = imitate sample files; 'scratch' = topic-only, no samples. */
  mode?: "sample" | "scratch";
  /** Scratch mode only: which question styles to produce. */
  question_kinds?: QuestionKind[];
  /** Scratch mode only: extracted text of the documents the author attached
   *  (name + digest). Persisted on the run for later preview — files themselves
   *  are never stored. */
  attachments?: ScratchDoc[];
}

export interface BankSpec {
  file: string;
  difficulty: Difficulty;
  count: number;
}

// ---- Create-from-scratch chat wizard ----

/** One turn of the scratch interview chat. */
export interface ScratchChatMsg {
  role: "user" | "assistant";
  text: string;
}

/** An attached reference document, reduced server-side to an assessable-content digest. */
export interface ScratchDoc {
  name: string;
  digest: string;
}

/** The complete generation brief the interview assistant assembles. */
export interface ScratchBrief {
  topic: string;
  /** Self-contained content guidance for the generation model (document facts baked in). */
  content_guidance: string;
  negative_prompt?: string;
  difficulty: Difficulty;
  count: number;
  question_kinds: QuestionKind[];
  mcq_type: MCQType;
  languages: Language[];
  create_images: boolean;
}

/** One follow-up question in an interview batch. */
export interface ScratchAskQuestion {
  question: string;
  quick_replies?: string[];
  multi?: boolean;
}

/** What the interview endpoint returns for one turn: a batch of independent
 *  follow-up questions (answered together on one screen), or the finished brief. */
export type ScratchInterviewReply =
  | { action: "ask"; questions: ScratchAskQuestion[] }
  | { action: "ready"; brief: ScratchBrief; summary: string };


/** One styled sample question offered for the author to pick from. */
export interface ScratchVariant {
  style_label: string;
  style_summary: string;
  kind: QuestionKind;
  mcq: {
    question: string;
    options: string[];
    correct_index: number;
    explanation?: string | null;
    snippet?: CodeSnippet | null;
  };
}

export interface SampleCatalogItem {
  filename: string;
  topic: string;
  count: number;
  languages: Language[];
  difficulties: Difficulty[];
  /** How many questions the bank has at each difficulty. */
  by_difficulty: { easy: number; medium: number; hard: number };
  has_code: boolean;
  primary_type: MCQType;
  primary_language: Language | null;
  /** Display name of whoever uploaded the bank (Local banks), or null. */
  uploaded_by: string | null;
}

export interface SampleTopic {
  filename: string;
  count: number;
  by_difficulty: Record<Difficulty, SampleTopicMCQ[]>;
}

export interface PastRunSummary {
  id: string;
  status: RunStatus;
  topic: string;
  difficulty: Difficulty;
  mcq_type: MCQType;
  count: number;
  quality: Quality;
  started_at: string;
  finished_at: string | null;
  error_message: string | null;
  sample_file_ids: string[];
  team?: string | null;
  /** Display name of whoever started the run; null on runs from before tracking. */
  created_by_name?: string | null;
  /** Server-persisted finalise state — team-wide, not per-browser. */
  finalised_at?: string | null;
  finalised_by?: string | null;
  /** Extracted text of documents attached in the scratch wizard (name + digest). */
  attachments?: ScratchDoc[] | null;
}

export interface SampleTopicMCQ {
  id: string;
  topic: string;
  difficulty: Difficulty;
  type: MCQType;
  language: Language | null;
  question: string;
  options: string[];
  correct_index: number;
  code: string | null;
}

/** One parsed-but-not-yet-saved sample question, shown in the upload preview. */
export interface SamplePreviewMCQ {
  topic: string;
  difficulty: Difficulty;
  type: MCQType;
  language: Language | null;
  question: string;
  options: string[];
  correct_index: number;
  code: string | null;
}

/**
 * Parsed contents of an uploaded workbook, grouped by difficulty so the user
 * can review the whole bank before committing it to the catalog.
 */
export interface SamplePreviewResult {
  ok: true;
  topic: string;
  source_file: string;
  total: number;
  code_count: number;
  general_count: number;
  by_difficulty: Record<Difficulty, SamplePreviewMCQ[]>;
}

export interface SampleCatalog {
  count: number;
  items: SampleCatalogItem[];
}

/** What a tag can group. `run` → item_id is a run id; `sample` → item_id is a bank filename. */
export type TagItemType = "run" | "sample";

export interface TagItem {
  item_type: TagItemType;
  item_id: string;
}

/** A team-scoped label with its members embedded (small sets, so no separate fetch). */
export interface Tag {
  id: string;
  name: string;
  color: string;
  items: TagItem[];
}

export interface StreamEvent {
  type: string;
  data: any;
}

export interface PlagMatch {
  source: string;
  url: string;
  similarity: number;
  question: string;
}

export interface PlagVerdict {
  verdict: "unique" | "flagged";
  matches: PlagMatch[];
  method: "corpus" | "web" | "corpus+web";
}

