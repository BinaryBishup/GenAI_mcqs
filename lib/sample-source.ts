/**
 * Helpers for deriving the unique `source_file` key a sample bank is stored
 * under. Shared by the preview (parse-only) and upload (commit) routes so both
 * propose the same name for a given topic.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

/** Strip filesystem-unsafe characters and clamp length for a source_file stem. */
export function sanitizeSourceName(name: string): string {
  return name.replace(/[\/\\:*?"<>|]/g, "-").replace(/\s+/g, " ").trim().slice(0, 120) || "sample";
}

/** Append " (2)", " (3)", … if a source_file with this name already exists. */
export async function uniqueSourceFile(
  supa: SupabaseClient,
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
