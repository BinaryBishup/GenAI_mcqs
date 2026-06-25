import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { parseWorkbookBuffer, normalizeTopic, type SampleRow } from "@/lib/xls-parse";
import { sanitizeSourceName, uniqueSourceFile } from "@/lib/sample-source";
import type { Difficulty, SamplePreviewMCQ } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Parse a Mettl .xls/.xlsx MCQ workbook and return its questions grouped by
 * difficulty — WITHOUT writing anything. The homepage shows this as a review
 * step; the user commits the bank via POST /api/samples/upload.
 *
 * multipart/form-data:
 *   file  — the workbook (required)
 *   topic — display name (optional; derived from the filename when omitted).
 */
export async function POST(req: NextRequest) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "expected multipart/form-data" }, { status: 400 });
  }

  const file = form.get("file");
  const topicRaw = String(form.get("topic") ?? "").trim();

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "no file uploaded" }, { status: 400 });
  }
  if (!/\.xlsx?$/i.test(file.name)) {
    return NextResponse.json({ error: "file must be a .xls or .xlsx workbook" }, { status: 400 });
  }
  if (file.size > 10 * 1024 * 1024) {
    return NextResponse.json({ error: "file too large (max 10 MB)" }, { status: 400 });
  }

  // Topic to display/commit under: explicit, else derived from the filename.
  const topic = topicRaw || normalizeTopic(file.name.replace(/\.xlsx?$/i, ""));
  const ext = file.name.toLowerCase().endsWith(".xlsx") ? ".xlsx" : ".xls";
  const sourceFile = await uniqueSourceFile(
    supabaseAdmin(),
    `${sanitizeSourceName(topic)}${ext}`,
    ext,
  );

  let rows: SampleRow[];
  try {
    const buf = Buffer.from(await file.arrayBuffer());
    rows = parseWorkbookBuffer(buf, file.name, { sourceFile, topicOverride: topic });
  } catch (e) {
    return NextResponse.json(
      { error: `could not parse workbook: ${e instanceof Error ? e.message : String(e)}` },
      { status: 422 },
    );
  }

  if (rows.length === 0) {
    return NextResponse.json(
      {
        error:
          "no questions found. Expected a sheet with a 'Question Text' column and 'Answer Choice' columns (Mettl bulk-upload format).",
      },
      { status: 422 },
    );
  }

  const by_difficulty: Record<Difficulty, SamplePreviewMCQ[]> = { easy: [], medium: [], hard: [] };
  for (const r of rows) {
    by_difficulty[r.difficulty].push({
      topic: r.topic,
      difficulty: r.difficulty,
      type: r.type,
      language: r.language,
      question: r.question,
      options: r.options,
      correct_index: r.correct_index,
      code: r.code,
    });
  }
  const codeCount = rows.filter((r) => r.type === "code").length;

  return NextResponse.json({
    ok: true,
    topic,
    source_file: sourceFile,
    total: rows.length,
    code_count: codeCount,
    general_count: rows.length - codeCount,
    by_difficulty,
  });
}
