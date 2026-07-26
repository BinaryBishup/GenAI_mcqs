import { NextRequest, NextResponse } from "next/server";
import { anthropic } from "@/lib/anthropic";
import { env } from "@/lib/env";
import { getUserTeam } from "@/lib/team";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Reduce one attached reference document to an assessable-content digest that
 * the interview chat can carry in its (stateless) transcript. Plain-text files
 * pass through directly; PDFs (and oversized text) go through Haiku, which
 * extracts the topics, facts, and terminology worth testing.
 *
 * multipart/form-data: file → { name, digest }
 */

const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_DIGEST_CHARS = 6_000;
const MAX_RAW_TEXT_CHARS = 60_000;

const EXTRACT_SYSTEM = `You extract the assessable content from a reference document for an MCQ-writing assistant. Return plain text (no markdown headers) covering: the subject and main subtopics; the concrete facts, definitions, procedures, numbers, and terminology worth testing; and the apparent audience/level. Be dense and specific — lists of real facts, not summaries about the document. Maximum 700 words. Do not mention the document or yourself.`;

export async function POST(req: NextRequest) {
  const { team } = await getUserTeam(req);
  if (!team) return NextResponse.json({ error: "not authenticated" }, { status: 401 });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "expected multipart/form-data" }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "file is required" }, { status: 400 });
  if (file.size > MAX_FILE_BYTES) return NextResponse.json({ error: `${file.name} is too large (max 20 MB)` }, { status: 400 });

  const name = file.name;
  const lower = name.toLowerCase();
  const isPdf = lower.endsWith(".pdf");
  const isText = lower.endsWith(".txt") || lower.endsWith(".md") || lower.endsWith(".csv");
  const isDocx = lower.endsWith(".docx");
  const isDoc = lower.endsWith(".doc") && !isDocx;
  const isExcel = lower.endsWith(".xlsx") || lower.endsWith(".xls");
  if (!isPdf && !isText && !isDocx && !isDoc && !isExcel) {
    return NextResponse.json(
      { error: `${name}: only .pdf, .docx, .doc, .xlsx, .xls, .csv, .txt and .md files are supported` },
      { status: 400 },
    );
  }

  // Word and Excel are extracted to plain text locally, then digested like text.
  let rawText: string | null = null;
  if (isText) {
    rawText = await file.text();
  } else if (isDocx) {
    try {
      const mammoth = await import("mammoth");
      const { value } = await mammoth.extractRawText({ buffer: Buffer.from(await file.arrayBuffer()) });
      rawText = value;
    } catch {
      return NextResponse.json({ error: `${name}: could not read this Word document — is it a valid .docx?` }, { status: 400 });
    }
  } else if (isDoc) {
    try {
      const { default: WordExtractor } = await import("word-extractor");
      const doc = await new WordExtractor().extract(Buffer.from(await file.arrayBuffer()));
      rawText = doc.getBody();
    } catch {
      return NextResponse.json({ error: `${name}: could not read this Word document — try saving it as .docx` }, { status: 400 });
    }
  } else if (isExcel) {
    try {
      const XLSX = await import("xlsx");
      const wb = XLSX.read(Buffer.from(await file.arrayBuffer()), { type: "buffer" });
      rawText = wb.SheetNames
        .map((sn) => `--- Sheet: ${sn} ---\n${XLSX.utils.sheet_to_csv(wb.Sheets[sn])}`)
        .join("\n\n");
    } catch {
      return NextResponse.json({ error: `${name}: could not read this Excel workbook` }, { status: 400 });
    }
  }

  if (rawText !== null) {
    const text = rawText.slice(0, MAX_RAW_TEXT_CHARS).trim();
    if (!text) return NextResponse.json({ error: `${name} is empty` }, { status: 400 });
    const digest = text.length <= MAX_DIGEST_CHARS ? text : await extract({ type: "text", text });
    return NextResponse.json({ name, digest });
  }

  const data = Buffer.from(await file.arrayBuffer()).toString("base64");
  try {
    const digest = await extract({ type: "document", source: { type: "base64", media_type: "application/pdf", data } });
    return NextResponse.json({ name, digest });
  } catch (e) {
    // Dev-only fallback: local networks that block api.anthropic.com delegate
    // to the deployed endpoint so the flow stays testable locally.
    if (process.env.NODE_ENV !== "production") {
      try {
        const fwd = new FormData();
        fwd.set("file", file);
        const r = await fetch("https://gen-ai-mcqs.vercel.app/api/scratch/ingest", {
          method: "POST",
          body: fwd,
          headers: { authorization: req.headers.get("authorization") ?? "" },
        });
        if (r.ok) return NextResponse.json(await r.json());
      } catch {
        /* fall through */
      }
    }
    return NextResponse.json(
      { error: `could not read ${name}: ${e instanceof Error ? e.message : String(e)}` },
      { status: 502 },
    );
  }
}

type Block =
  | { type: "text"; text: string }
  | { type: "document"; source: { type: "base64"; media_type: "application/pdf"; data: string } };

async function extract(block: Block): Promise<string> {
  const res = await anthropic().messages.create({
    model: env.modelFor("fast"),
    max_tokens: 1200,
    system: EXTRACT_SYSTEM,
    messages: [{ role: "user", content: [block] }],
  });
  if (!Array.isArray(res.content)) throw new Error("Anthropic API unreachable (network intercepted the request)");
  const text = res.content.filter((b) => b.type === "text").map((b) => b.text).join("").trim();
  if (!text) throw new Error("empty extraction");
  return text.slice(0, MAX_DIGEST_CHARS);
}
