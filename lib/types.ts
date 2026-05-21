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
}

export interface SampleCatalogItem {
  filename: string;
  topic: string;
  count: number;
  languages: Language[];
  difficulties: Difficulty[];
  has_code: boolean;
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
  method: "corpus";
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
