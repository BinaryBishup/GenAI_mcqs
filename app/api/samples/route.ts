import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { getUserTeam } from "@/lib/team";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LANG_PATTERNS: { rx: RegExp; lang: string }[] = [
  { rx: /\bpython\b/i, lang: "python" },
  { rx: /\b(core\s+)?java\b(?!\s*script)/i, lang: "java" },
  { rx: /\bjavascript\b|^js\b|\sjs\b/i, lang: "javascript" },
  { rx: /\bc\s*sharp\b|\bc#\b/i, lang: "csharp" },
  { rx: /\bc\+\+|\bcpp\b/i, lang: "cpp" },
  { rx: /\bhtml5?\b/i, lang: "html" },
  { rx: /\bcss3?\b/i, lang: "css" },
  { rx: /^c\s/i, lang: "c" },
];

function inferLanguageFromFilename(filename: string): string | null {
  for (const { rx, lang } of LANG_PATTERNS) {
    if (rx.test(filename)) return lang;
  }
  return null;
}

/** Catalog: one row per source_file, with metadata aggregated. Team-scoped. */
export async function GET(req: NextRequest) {
  const supa = supabaseAdmin();

  const { team } = await getUserTeam(req);
  if (!team) return NextResponse.json({ error: "not authenticated" }, { status: 401 });

  // Supabase caps a single select at 1000 rows; the samples table is larger, so
  // page through all rows (ordered by the PK for stable, non-overlapping ranges)
  // before aggregating. Otherwise banks outside the first 1000 rows — including
  // newly uploaded ones — silently vanish from the catalog.
  const PAGE = 1000;
  const data: { source_file: string; topic: string; difficulty: string; type: string; language: string | null; uploaded_by: string | null }[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data: page, error } = await supa
      .from("samples")
      .select("source_file,topic,difficulty,type,language,uploaded_by")
      .eq("team", team)
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!page || page.length === 0) break;
    data.push(...(page as typeof data));
    if (page.length < PAGE) break;
  }

  type Agg = {
    filename: string;
    topic: string;
    count: number;
    code_count: number;
    languages: Set<string>;
    difficulties: Set<string>;
    by_difficulty: { easy: number; medium: number; hard: number };
    has_code: boolean;
    uploaded_by: string | null;
  };
  const byFile = new Map<string, Agg>();

  for (const r of data ?? []) {
    const f = r.source_file as string;
    if (!byFile.has(f)) {
      byFile.set(f, {
        filename: f,
        topic: (r.topic as string) ?? f,
        count: 0,
        code_count: 0,
        languages: new Set(),
        difficulties: new Set(),
        by_difficulty: { easy: 0, medium: 0, hard: 0 },
        has_code: false,
        uploaded_by: null,
      });
    }
    const e = byFile.get(f)!;
    e.count += 1;
    if (r.type === "code") {
      e.code_count += 1;
      e.has_code = true;
    }
    if (r.language) e.languages.add(String(r.language));
    const d = String(r.difficulty ?? "").toLowerCase();
    if (d === "easy" || d === "medium" || d === "hard") {
      e.difficulties.add(d);
      e.by_difficulty[d] += 1;
    }
    if (!e.uploaded_by && r.uploaded_by) e.uploaded_by = String(r.uploaded_by);
  }

  const items = [...byFile.values()]
    .sort((a, b) => a.filename.localeCompare(b.filename))
    .map((e) => {
      // Primary type: majority rule. >= 50% code → "code", else "general".
      const primary_type: "code" | "general" =
        e.code_count * 2 >= e.count ? "code" : "general";

      // Primary language: most populous, or inferred from filename if none.
      let primary_language: string | null = null;
      if (e.languages.size > 0) {
        primary_language = [...e.languages][0];
      } else {
        primary_language = inferLanguageFromFilename(e.filename);
      }

      return {
        filename: e.filename,
        topic: e.topic,
        count: e.count,
        languages: [...e.languages].sort(),
        difficulties: [...e.difficulties].sort(),
        by_difficulty: e.by_difficulty,
        has_code: e.has_code,
        primary_type,
        primary_language,
        uploaded_by: e.uploaded_by,
      };
    });

  return NextResponse.json({ count: items.length, items });
}
