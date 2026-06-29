import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type { MCQ } from "./types";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Is this MCQ safe to ship by default? A question is "usable" unless a quality
 * gate actively flagged it: plagiarism flagged/gave-up, code verification
 * failed, or the independent answer-check disagreed / was uncertain. Used to
 * exclude failed items from the default export. Client- and server-safe (no
 * heavy imports), so both the UI and export route can call it.
 */
export function isUsable(mcq: MCQ): boolean {
  if (mcq.plag_status === "flagged" || mcq.plag_status === "gave_up") return false;
  if (mcq.code_verified === false) return false;
  if (mcq.answer_check_status === "disagree" || mcq.answer_check_status === "uncertain") return false;
  if (mcq.diversity_status === "duplicate") return false;
  return true;
}

/** Short human reason an MCQ is excluded, or null if usable. */
export function exclusionReason(mcq: MCQ): string | null {
  if (mcq.plag_status === "flagged") return "too similar to existing questions";
  if (mcq.plag_status === "gave_up") return "couldn't be made original";
  if (mcq.code_verified === false) return "code did not verify";
  if (mcq.answer_check_status === "disagree") return "answer-check disagreed with the key";
  if (mcq.answer_check_status === "uncertain") return "answer-check could not confirm the key";
  if (mcq.diversity_status === "duplicate") return "too similar to a sibling variant";
  return null;
}

export function normalizeText(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

export function shortId(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
