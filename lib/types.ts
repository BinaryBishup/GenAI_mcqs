export type Language = "python" | "java" | "cpp" | "c" | "csharp" | "javascript" | "html" | "css";
export type MCQType = "general" | "code";
export type Difficulty = "easy" | "medium" | "hard";
export type Quality = "fast" | "balanced" | "highest";
export type PlagStatus = "pending" | "unique" | "flagged" | "revamped" | "gave_up";
export type RunStatus = "pending" | "generating" | "plagchecking" | "revamping" | "verifying" | "done" | "error";

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
