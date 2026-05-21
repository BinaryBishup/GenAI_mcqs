export type Language = "python" | "java" | "cpp" | "c" | "csharp" | "javascript" | "html" | "css";
export type MCQType = "general" | "code";
export type Difficulty = "easy" | "medium" | "hard";
export type Quality = "fast" | "balanced" | "highest";

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
  plag_status?: "pending" | "unique" | "flagged" | "revamped";
  plag_matches?: string[];
  plag_attempts?: number;
  code_verified?: boolean | null;
  code_actual_output?: string | null;
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
  error?: string;
}

export interface SampleCatalog {
  samples_dir: string;
  count: number;
  items: SampleCatalogItem[];
}

export interface StreamEvent {
  type: string;
  data: any;
}
