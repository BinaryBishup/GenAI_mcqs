import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { parseWorkbookBuffer, type SampleRow } from "@/lib/xls-parse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Upload a Mettl .xls/.xlsx workbook, parse it, and insert its rows into the
 * `samples` table so it shows up in the homepage catalog.
 *
 * multipart/form-data:
 *   file  — the workbook (required)
 *   topic — display name for the topic (required); applied to every row and
 *           used as the unique source_file key.
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
  if (!topicRaw) {
    return NextResponse.json({ error: "topic name is required" }, { status: 400 });
  }
  if (!/\.xlsx?$/i.test(file.name)) {
    return NextResponse.json({ error: "file must be a .xls or .xlsx workbook" }, { status: 400 });
  }
  if (file.size > 10 * 1024 * 1024) {
    return NextResponse.json({ error: "file too large (max 10 MB)" }, { status: 400 });
  }

  const supa = supabaseAdmin();

  // Use the topic as the unique source_file key so the catalog groups by it
  // and the user controls the displayed name. De-dupe against existing files.
  const ext = file.name.toLowerCase().endsWith(".xlsx") ? ".xlsx" : ".xls";
  const baseSource = `${sanitize(topicRaw)}${ext}`;
  const sourceFile = await uniqueSourceFile(supa, baseSource, ext);

  let rows: SampleRow[];
  try {
    const buf = Buffer.from(await file.arrayBuffer());
    rows = parseWorkbookBuffer(buf, file.name, {
      sourceFile,
      topicOverride: topicRaw,
    });
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

  // Insert in chunks (Postgres parameter limits on big workbooks).
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200);
    const { error } = await supa.from("samples").insert(chunk);
    if (error) {
      return NextResponse.json({ error: `insert failed: ${error.message}` }, { status: 500 });
    }
  }

  const codeCount = rows.filter((r) => r.type === "code").length;
  return NextResponse.json({
    ok: true,
    source_file: sourceFile,
    topic: topicRaw,
    inserted: rows.length,
    code_count: codeCount,
    general_count: rows.length - codeCount,
  });
}

function sanitize(name: string): string {
  return name.replace(/[\/\\:*?"<>|]/g, "-").replace(/\s+/g, " ").trim().slice(0, 120) || "sample";
}

/** Append " (2)", " (3)", … if a source_file with this name already exists. */
async function uniqueSourceFile(
  supa: ReturnType<typeof supabaseAdmin>,
  base: string,
  ext: string,
): Promise<string> {
  const stem = base.slice(0, base.length - ext.length);
  let candidate = base;
  for (let n = 2; n < 1000; n++) {
    const { count, error } = await supa
      .from("samples")
      .select("id", { count: "exact", head: true })
      .eq("source_file", candidate);
    if (error) break; // best-effort; fall through with current candidate
    if (!count) return candidate;
    candidate = `${stem} (${n})${ext}`;
  }
  return candidate;
}
