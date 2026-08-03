import { database } from "@/lib/server/db";

/**
 * Per-seed expansion ("item cloning").
 *
 * Instead of blending a few-shot slice of a bank into one undifferentiated
 * prompt, sample-mode generation now treats EACH source question as a seed and
 * produces K novel variants of it. Because every variant inherits its seed's
 * type / shape / difficulty, the bank's composition is preserved by
 * construction — no separate distribution matching needed.
 */
export interface SeedRow {
  id: string;
  topic: string;
  difficulty: string;
  type: string;
  language: string | null;
  question: string;
  options: string[];
  correct_index: number;
  code: string | null;
}

/** One seed and how many variants to generate from it. */
export interface SeedAssignment {
  seed: SeedRow;
  count: number;
}

/** Fisher–Yates, in place. */
function shuffleInPlace<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Load the full set of questions across the selected bank(s) as the seed pool.
 * Paginated so large banks are fully represented rather than truncated.
 */
export async function loadSeedPool(files: string[], difficulty?: string): Promise<SeedRow[]> {
  if (files.length === 0) return [];
  const db = database();
  const sel = "id,topic,difficulty,type,language,question,options,correct_index,code";
  const pool: SeedRow[] = [];
  for (const f of files) {
    for (let from = 0; ; from += 1000) {
      let query = db
        .from("samples")
        .select(sel)
        .eq("source_file", f);
      // Difficulty-filtered seeding: a "medium" request only ever sees the
      // bank's medium questions, so variants are unambiguously medium.
      if (difficulty) query = query.eq("difficulty", difficulty);
      const { data, error } = await query
        .order("id", { ascending: true })
        .range(from, from + 999);
      if (error || !data || data.length === 0) break;
      pool.push(...(data as SeedRow[]));
      if (data.length < 1000) break;
    }
  }
  return pool;
}

/**
 * Decide how many variants each seed should produce so the total equals `n`.
 *
 *  - n >= poolSize → every seed expands; the remainder (n mod poolSize) is
 *    spread across randomly-chosen seeds (+1 each), so per-seed counts differ
 *    by at most one and the bank's mix is preserved.
 *  - n <  poolSize → pick `n` random seeds, one variant each.
 *
 * The pool is shuffled first, so "first `rem` seeds get +1" and "first `n`
 * seeds" are both already random selections.
 */
export function planSeeds(pool: SeedRow[], n: number, shuffle = true): SeedAssignment[] {
  if (pool.length === 0 || n <= 0) return [];
  // When the caller has already diversity-ordered the pool, keep that order
  // (the first `n` are the most conceptually-distinct seeds).
  const shuffled = shuffle ? shuffleInPlace([...pool]) : [...pool];
  const s = shuffled.length;

  if (n < s) {
    return shuffled.slice(0, n).map((seed) => ({ seed, count: 1 }));
  }

  const base = Math.floor(n / s);
  const rem = n % s;
  return shuffled.map((seed, i) => ({ seed, count: base + (i < rem ? 1 : 0) }));
}
