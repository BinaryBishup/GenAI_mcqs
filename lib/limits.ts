/**
 * Daily generation budget, shared by the API (enforcement) and the sidebar
 * meter (display). Actual Anthropic usage is not persisted server-side, so the
 * budget is expressed in questions and converted to tokens with an estimate.
 */

/** Estimated tokens one generated question costs end-to-end (generation +
 *  verification + answer-check passes, input and output). */
export const EST_TOKENS_PER_QUESTION = 5_000;

/** Daily token budget per team — roughly 12 ten-question generations. */
export const DAILY_TOKEN_BUDGET = 750_000;

/** The budget in questions — what POST /api/generate actually enforces. */
export const DAILY_QUESTION_LIMIT = DAILY_TOKEN_BUDGET / EST_TOKENS_PER_QUESTION;
