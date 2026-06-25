export type Language = "python" | "java" | "cpp" | "c" | "csharp" | "javascript" | "html" | "css";
export type MCQType = "general" | "code";
export type Difficulty = "easy" | "medium" | "hard";
export type Quality = "fast" | "balanced" | "highest";
export type PlagStatus = "pending" | "unique" | "flagged" | "revamped" | "gave_up";
export type RunStatus = "pending" | "generating" | "plagchecking" | "revamping" | "verifying" | "done" | "error";

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
  code_verified?: boolean | null;
  code_actual_output?: string | null;
  code_fix?: string | null;
  /** Independent re-derivation of the answer for non-code MCQs. */
  answer_check_status?: AnswerCheckStatus;
  /** Option index the independent checker believed correct (for disagree). */
  answer_check_index?: number | null;
  /** One-line rationale from the checker. */
  answer_check_notes?: string | null;
}

export interface GenerateRequest {
  count: number;
  topic: string;
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
  /** 'sample' = imitate sample files; 'scratch' = topic-only, no samples. */
  mode?: "sample" | "scratch";
  /** Scratch mode only: which question styles to produce. */
  question_kinds?: QuestionKind[];
}

export interface SampleCatalogItem {
  filename: string;
  topic: string;
  count: number;
  languages: Language[];
  difficulties: Difficulty[];
  has_code: boolean;
  primary_type: MCQType;
  primary_language: Language | null;
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

export interface Judge0Result {
  ok: boolean;
  stdout: string;
  stderr: string;
  exit_code: number;
  duration_ms: number;
}

export type VerifyFix =
  | "none"
  | "reassigned_correct_index"
  | "regenerate_options"
  | "compile_or_runtime_error"
  | "skipped_unsupported_language"
  | "timeout";

export interface VerifyOutcome {
  verified: boolean | null;
  actual_stdout: string;
  fix: VerifyFix;
  new_correct_index: number | null;
  stderr: string;
}
