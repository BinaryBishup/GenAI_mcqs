// Direct-Postgres data adapter (RDS / any vanilla Postgres).
//
// The app's data layer was written against the supabase-js query builder
// (PostgREST). This module implements the EXACT subset of that surface the
// codebase uses, backed by node-postgres, so every existing call site works
// unchanged against a plain `DATABASE_URL` — no PostgREST, no Supabase.
//
// Supported surface (verified by grep across lib/ and app/):
//   from(t).select(cols?, {count:'exact', head:true}?)
//   from(t).insert(row|rows[]).select(...)?.single()?
//   from(t).update(patch)  from(t).delete()  from(t).upsert(row, {onConflict, ignoreDuplicates})
//   .eq .neq .in .gte  |  .order .limit .range .single .maybeSingle
//   rpc(fn, namedArgs)
// Anything outside this list throws loudly instead of misbehaving silently.

import { Pool } from "pg";

let _pool: Pool | null = null;

export function pgPool(): Pool {
  if (_pool) return _pool;
  const cs = process.env.DATABASE_URL;
  if (!cs) throw new Error("DATABASE_URL is not set");
  _pool = new Pool({
    connectionString: cs,
    max: Number(process.env.DATABASE_POOL_MAX || "10"),
    // RDS requires TLS by default; set DATABASE_SSL=disable for a local Postgres.
    ssl: process.env.DATABASE_SSL === "disable" ? undefined : { rejectUnauthorized: false },
  });
  return _pool;
}

type PgError = { message: string } | null;
type Result = { data: any; error: PgError; count: number | null };

const IDENT = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

function q(ident: string): string {
  if (!IDENT.test(ident)) throw new Error(`invalid identifier: ${ident}`);
  return `"${ident}"`;
}

function cols(list: string): string {
  const trimmed = list.trim();
  if (trimmed === "*" || trimmed === "") return "*";
  return trimmed
    .split(",")
    .map((c) => q(c.trim()))
    .join(", ");
}

/** JS value → pg parameter. Objects/arrays serialise to JSON text so untyped
 *  params coerce into jsonb columns; Dates pass through natively. */
function toParam(v: unknown): unknown {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v;
  if (Array.isArray(v) || typeof v === "object") return JSON.stringify(v);
  return v;
}

class PgQuery implements PromiseLike<Result> {
  private op: "select" | "insert" | "update" | "delete" | "upsert" = "select";
  private colList = "*";
  private countMode = false;
  private headMode = false;
  private payload: Record<string, unknown>[] = [];
  private wheres: string[] = [];
  private params: unknown[] = [];
  private orderBys: string[] = [];
  private limitN: number | null = null;
  private offsetN: number | null = null;
  private wantSingle: "no" | "single" | "maybe" = "no";
  private returning = false;
  private conflictCols: string | null = null;
  private ignoreDup = false;

  constructor(private table: string) {
    q(table); // validate early
  }

  // ---- verbs ----
  select(list = "*", opts?: { count?: "exact"; head?: boolean }): this {
    if (this.op === "select") {
      this.colList = list;
      if (opts?.count) this.countMode = true;
      if (opts?.head) this.headMode = true;
    } else {
      // insert(...).select(...) → RETURNING
      this.returning = true;
      this.colList = list;
    }
    return this;
  }
  insert(rows: Record<string, unknown> | Record<string, unknown>[]): this {
    this.op = "insert";
    this.payload = Array.isArray(rows) ? rows : [rows];
    return this;
  }
  upsert(rows: Record<string, unknown> | Record<string, unknown>[], opts?: { onConflict?: string; ignoreDuplicates?: boolean }): this {
    this.op = "upsert";
    this.payload = Array.isArray(rows) ? rows : [rows];
    this.conflictCols = opts?.onConflict ?? null;
    this.ignoreDup = opts?.ignoreDuplicates ?? false;
    return this;
  }
  update(patch: Record<string, unknown>): this {
    this.op = "update";
    this.payload = [patch];
    return this;
  }
  delete(): this {
    this.op = "delete";
    return this;
  }

  // ---- filters ----
  private addParam(v: unknown): string {
    this.params.push(toParam(v));
    return `$${this.params.length}`;
  }
  eq(col: string, v: unknown): this {
    this.wheres.push(`${q(col)} = ${this.addParam(v)}`);
    return this;
  }
  neq(col: string, v: unknown): this {
    this.wheres.push(`${q(col)} <> ${this.addParam(v)}`);
    return this;
  }
  gte(col: string, v: unknown): this {
    this.wheres.push(`${q(col)} >= ${this.addParam(v)}`);
    return this;
  }
  in(col: string, values: unknown[]): this {
    // text-compare both sides so uuid/text columns behave alike at our scale
    this.params.push((values ?? []).map(String));
    this.wheres.push(`${q(col)}::text = ANY($${this.params.length}::text[])`);
    return this;
  }
  not(col: string, operator: string, v: unknown): this {
    if (operator === "is" && v === null) {
      this.wheres.push(`${q(col)} IS NOT NULL`);
      return this;
    }
    throw new Error(`pg-rest: .not(${operator}) not supported`);
  }

  // ---- modifiers ----
  order(col: string, opts?: { ascending?: boolean }): this {
    this.orderBys.push(`${q(col)} ${opts?.ascending === false ? "DESC" : "ASC"}`);
    return this;
  }
  limit(n: number): this {
    this.limitN = n;
    return this;
  }
  range(from: number, to: number): this {
    this.offsetN = from;
    this.limitN = to - from + 1;
    return this;
  }
  single(): this {
    this.wantSingle = "single";
    return this;
  }
  maybeSingle(): this {
    this.wantSingle = "maybe";
    return this;
  }

  // ---- execution ----
  private buildWhere(): string {
    return this.wheres.length ? ` WHERE ${this.wheres.join(" AND ")}` : "";
  }
  private buildTail(): string {
    let s = "";
    if (this.orderBys.length) s += ` ORDER BY ${this.orderBys.join(", ")}`;
    if (this.limitN !== null) s += ` LIMIT ${Math.max(0, Math.floor(this.limitN))}`;
    if (this.offsetN !== null) s += ` OFFSET ${Math.max(0, Math.floor(this.offsetN))}`;
    return s;
  }

  private async exec(): Promise<Result> {
    const pool = pgPool();
    try {
      if (this.op === "select") {
        let count: number | null = null;
        if (this.countMode) {
          const c = await pool.query(`SELECT count(*)::int AS n FROM ${q(this.table)}${this.buildWhere()}`, this.params);
          count = c.rows[0]?.n ?? 0;
          if (this.headMode) return { data: null, error: null, count };
        }
        const sql = `SELECT ${cols(this.colList)} FROM ${q(this.table)}${this.buildWhere()}${this.buildTail()}`;
        const res = await pool.query(sql, this.params);
        return this.shape(res.rows, count);
      }

      if (this.op === "insert" || this.op === "upsert") {
        if (this.payload.length === 0) return { data: [], error: null, count: null };
        const keys = Object.keys(this.payload[0]);
        keys.forEach(q);
        const valueParams: unknown[] = [];
        const tuples = this.payload
          .map((row) => {
            const ph = keys.map((k) => {
              valueParams.push(toParam(row[k]));
              return `$${valueParams.length}`;
            });
            return `(${ph.join(", ")})`;
          })
          .join(", ");
        let sql = `INSERT INTO ${q(this.table)} (${keys.map(q).join(", ")}) VALUES ${tuples}`;
        if (this.op === "upsert") {
          const conflict = (this.conflictCols ?? "").split(",").map((c) => q(c.trim())).join(", ");
          sql += this.ignoreDup
            ? ` ON CONFLICT (${conflict}) DO NOTHING`
            : ` ON CONFLICT (${conflict}) DO UPDATE SET ${keys.map((k) => `${q(k)} = EXCLUDED.${q(k)}`).join(", ")}`;
        }
        if (this.returning) sql += ` RETURNING ${cols(this.colList)}`;
        const res = await pool.query(sql, valueParams);
        return this.shape(this.returning ? res.rows : null, null);
      }

      if (this.op === "update") {
        if (this.wheres.length === 0) throw new Error(`refusing UPDATE on ${this.table} without filters`);
        const patch = this.payload[0] ?? {};
        const sets = Object.keys(patch).map((k) => `${q(k)} = ${this.addParam(patch[k])}`);
        if (sets.length === 0) return { data: null, error: null, count: null };
        let sql = `UPDATE ${q(this.table)} SET ${sets.join(", ")}${this.buildWhere()}`;
        if (this.returning) sql += ` RETURNING ${cols(this.colList)}`;
        const res = await pool.query(sql, this.params);
        return this.shape(this.returning ? res.rows : null, null);
      }

      // delete
      if (this.wheres.length === 0) throw new Error(`refusing DELETE on ${this.table} without filters`);
      let sql = `DELETE FROM ${q(this.table)}${this.buildWhere()}`;
      if (this.returning) sql += ` RETURNING ${cols(this.colList)}`;
      const res = await pool.query(sql, this.params);
      return this.shape(this.returning ? res.rows : null, null);
    } catch (e) {
      return { data: null, error: { message: e instanceof Error ? e.message : String(e) }, count: null };
    }
  }

  private shape(rows: any[] | null, count: number | null): Result {
    if (this.wantSingle === "single") {
      if (!rows || rows.length !== 1) {
        return { data: null, error: { message: `expected exactly one row, got ${rows?.length ?? 0}` }, count };
      }
      return { data: rows[0], error: null, count };
    }
    if (this.wantSingle === "maybe") {
      if (rows && rows.length > 1) return { data: null, error: { message: `expected at most one row, got ${rows.length}` }, count };
      return { data: rows?.[0] ?? null, error: null, count };
    }
    return { data: rows, error: null, count };
  }

  then<T1 = Result, T2 = never>(
    onfulfilled?: ((value: Result) => T1 | PromiseLike<T1>) | null,
    onrejected?: ((reason: unknown) => T2 | PromiseLike<T2>) | null,
  ): PromiseLike<T1 | T2> {
    return this.exec().then(onfulfilled, onrejected);
  }
}

async function execRpc(fn: string, args: Record<string, unknown>): Promise<Result> {
  try {
    q(fn);
    const names = Object.keys(args ?? {});
    names.forEach(q);
    const params: unknown[] = [];
    const argList = names
      .map((n) => {
        params.push(toParam(args[n]));
        return `${q(n)} => $${params.length}`;
      })
      .join(", ");
    const res = await pgPool().query(`SELECT * FROM ${q(fn)}(${argList})`, params);
    return { data: res.rows, error: null, count: null };
  } catch (e) {
    return { data: null, error: { message: e instanceof Error ? e.message : String(e) }, count: null };
  }
}

/** supabase-js-shaped client backed by direct Postgres. */
export function pgRestClient() {
  return {
    from: (table: string) => new PgQuery(table),
    rpc: (fn: string, args: Record<string, unknown> = {}) => execRpc(fn, args),
    auth: new Proxy(
      {},
      {
        get() {
          throw new Error("pg-rest has no auth — use supabaseAuthAdmin() for auth calls (auth stays on Supabase)");
        },
      },
    ),
  };
}
