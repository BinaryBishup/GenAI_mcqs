from __future__ import annotations

from typing import Literal, Optional
from pydantic import BaseModel, Field


Language = Literal["python", "java", "cpp", "c", "csharp", "javascript", "html", "css"]
MCQType = Literal["general", "code"]
Difficulty = Literal["easy", "medium", "hard"]
Quality = Literal["fast", "balanced", "highest"]


class CodeSnippet(BaseModel):
    language: Language
    code: str
    stdin: Optional[str] = None


class MCQ(BaseModel):
    id: str
    type: MCQType
    topic: str
    difficulty: Difficulty
    question: str
    options: list[str] = Field(min_length=2, max_length=8)
    correct_index: int = Field(ge=0, le=7)
    explanation: Optional[str] = None
    snippet: Optional[CodeSnippet] = None
    # populated by workflow
    plag_status: Literal["pending", "unique", "flagged", "revamped"] = "pending"
    plag_matches: list[str] = Field(default_factory=list)
    plag_attempts: int = 0
    code_verified: Optional[bool] = None
    code_actual_output: Optional[str] = None


class GenerateRequest(BaseModel):
    count: int = Field(ge=1, le=50, default=5)
    topic: str
    difficulty: Difficulty = "medium"
    mcq_type: MCQType = "general"
    # If code, languages to use
    languages: list[Language] = Field(default_factory=lambda: ["python"])
    samples: list[MCQ] = Field(default_factory=list)
    # Free-form sample text the user pasted in (if they didn't structure it)
    samples_raw: Optional[str] = None
    # Filenames (relative to samples/) to load as samples — preferred over paste
    sample_files: list[str] = Field(default_factory=list)
    # How many sample MCQs from each selected file to include in the prompt
    samples_per_file: int = Field(ge=1, le=20, default=4)
    # Max revamp attempts when plagiarism check flags a question
    max_revamp_attempts: int = 3
    # Orchestrator quality. fast=haiku, balanced=sonnet, highest=opus.
    quality: Quality = "fast"


class WorkflowEvent(BaseModel):
    """Streamed over SSE to the frontend."""
    type: str
    data: dict = Field(default_factory=dict)


class CompileResult(BaseModel):
    ok: bool
    stdout: str
    stderr: str
    exit_code: int
    duration_ms: int
