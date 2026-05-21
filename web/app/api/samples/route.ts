import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";

/** Catalog: one row per source_file, with metadata aggregated. */
export async function GET() {
  const supa = supabaseAdmin();
  const { data, error } = await supa
    .from("samples")
    .select("source_file,topic,difficulty,type,language");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const byFile = new Map<string, {
    filename: string;
    topic: string;
    count: number;
    languages: Set<string>;
    difficulties: Set<string>;
    has_code: boolean;
  }>();

  for (const r of data ?? []) {
    const f = r.source_file as string;
    if (!byFile.has(f)) {
      byFile.set(f, {
        filename: f,
        topic: (r.topic as string) ?? f,
        count: 0,
        languages: new Set(),
        difficulties: new Set(),
        has_code: false,
      });
    }
    const e = byFile.get(f)!;
    e.count += 1;
    if (r.language) e.languages.add(String(r.language));
    if (r.difficulty) e.difficulties.add(String(r.difficulty));
    if (r.type === "code") e.has_code = true;
  }

  const items = [...byFile.values()]
    .sort((a, b) => a.filename.localeCompare(b.filename))
    .map((e) => ({
      filename: e.filename,
      topic: e.topic,
      count: e.count,
      languages: [...e.languages].sort(),
      difficulties: [...e.difficulties].sort(),
      has_code: e.has_code,
    }));

  return NextResponse.json({ count: items.length, items });
}
