import { env } from "./env";
import type { Judge0Result, Language } from "./types";

/**
 * Judge0 CE language IDs. Source: judge0-ce.p.rapidapi.com/languages
 * These are stable as of 2025. If a language returns 422, hit the languages
 * endpoint and confirm the ID is still current.
 */
const LANGUAGE_IDS: Record<Language, number | null> = {
  python: 71,      // Python (3.8.1)
  java: 62,        // Java (OpenJDK 13.0.1)
  cpp: 54,         // C++ (GCC 9.2.0)
  c: 50,           // C (GCC 9.2.0)
  csharp: 51,      // C# (Mono 6.6.0.161)
  javascript: 63,  // JavaScript (Node 12.14.0)
  html: null,      // not supported by Judge0
  css: null,       // not supported by Judge0
};

interface Judge0Submission {
  stdout: string | null;
  stderr: string | null;
  compile_output: string | null;
  message: string | null;
  status: { id: number; description: string };
  time: string | null;        // seconds, as a string
  memory: number | null;
}

const STATUS_ACCEPTED = 3;
const STATUS_TIME_LIMIT = 5;

export async function runCode(language: Language, code: string, stdin?: string | null): Promise<Judge0Result> {
  const langId = LANGUAGE_IDS[language];
  if (langId == null) {
    return {
      ok: false,
      stdout: "",
      stderr: `language '${language}' has no host toolchain — verification skipped`,
      exit_code: 2,
      duration_ms: 0,
    };
  }

  const url = `https://${env.judge0Host()}/submissions?base64_encoded=true&wait=true`;
  const body = {
    source_code: Buffer.from(code).toString("base64"),
    language_id: langId,
    stdin: stdin ? Buffer.from(stdin).toString("base64") : null,
    cpu_time_limit: 8,
    wall_time_limit: 12,
    memory_limit: 128000,
  };

  const start = Date.now();
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-rapidapi-host": env.judge0Host(),
      "x-rapidapi-key": env.judge0Key(),
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    return {
      ok: false,
      stdout: "",
      stderr: `judge0 http ${res.status}: ${await res.text()}`,
      exit_code: 1,
      duration_ms: Date.now() - start,
    };
  }

  const sub = (await res.json()) as Judge0Submission;
  const decode = (s: string | null) => (s ? Buffer.from(s, "base64").toString("utf-8") : "");

  const stdout = decode(sub.stdout);
  const stderr = [decode(sub.stderr), decode(sub.compile_output), sub.message ?? ""]
    .filter(Boolean)
    .join("\n")
    .trim();
  const exit_code = sub.status.id === STATUS_ACCEPTED ? 0 : sub.status.id === STATUS_TIME_LIMIT ? 124 : 1;

  return {
    ok: sub.status.id === STATUS_ACCEPTED,
    stdout,
    stderr,
    exit_code,
    duration_ms: Math.round(parseFloat(sub.time ?? "0") * 1000) || Date.now() - start,
  };
}
