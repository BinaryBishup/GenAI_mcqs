// Smoke test for lib/pg-rest.ts against a real Postgres (DATABASE_URL).
// Exercises every query pattern the app uses. Run:
//   DATABASE_URL=postgres://localhost/assessly_test DATABASE_SSL=disable npx tsx scripts/test-pg-rest.ts
import { pgRestClient, pgPool } from "../lib/pg-rest";

const db = pgRestClient();
let failures = 0;

function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) console.log(`  ok  ${name}`);
  else {
    failures++;
    console.error(`FAIL  ${name}`, detail ?? "");
  }
}

async function main() {
  // ---- insert run RETURNING single (runner.ts pattern) ----
  const ins = await (db.from("runs").insert({
    status: "generating",
    topic: "pg-rest smoke test",
    difficulty: "medium",
    mcq_type: "general",
    count: 3,
    quality: "balanced",
    languages: [],
    sample_file_ids: ["bank-a.xlsx"],
    samples_per_file: 4,
    max_revamp_attempts: 3,
    team: "HACK",
    attachments: [{ name: "doc.md", digest: "digest text" }],
  }) as any).select().single();
  check("insert run returning single", !ins.error && ins.data?.id && ins.data.topic === "pg-rest smoke test", ins.error);
  const runId = ins.data.id as string;
  check("jsonb array roundtrip", Array.isArray(ins.data.sample_file_ids) && ins.data.sample_file_ids[0] === "bank-a.xlsx");
  check("jsonb object-array roundtrip", ins.data.attachments?.[0]?.name === "doc.md");

  // ---- bulk insert mcqs (insertMCQs pattern) ----
  const rows = [0, 1, 2].map((i) => ({
    run_id: runId,
    index: i,
    type: "general",
    topic: "t",
    difficulty: "medium",
    question: `Q${i} unique text ${i}`,
    options: ["a", "b", "c", "d"],
    correct_index: i % 4,
    explanation: null,
    plag_status: "pending",
    plag_matches: [],
    plag_attempts: 0,
  }));
  const bulk = await db.from("mcqs").insert(rows);
  check("bulk insert mcqs", !(bulk as any).error, (bulk as any).error);

  // ---- update with filters (persistPlag pattern) ----
  const upd = await (db.from("mcqs").update({ plag_status: "unique", plag_matches: ["http://x"] }) as any)
    .eq("run_id", runId)
    .eq("index", 1);
  check("update with eq filters", !upd.error, upd.error);

  // ---- select * with order (runs/[id] pattern) ----
  const sel = await (db.from("mcqs").select("*") as any).eq("run_id", runId).order("index");
  check("select * order", !sel.error && sel.data?.length === 3 && sel.data[1].plag_status === "unique", sel.error);
  check("jsonb select roundtrip", Array.isArray(sel.data[0].options) && sel.data[0].options.length === 4);

  // ---- count + head (sample-source pattern) ----
  const cnt = await (db.from("mcqs").select("id", { count: "exact", head: true }) as any).eq("run_id", runId);
  check("count head", cnt.count === 3 && cnt.data === null, cnt);

  // ---- gte + neq (daily budget pattern) ----
  const day = new Date();
  day.setHours(0, 0, 0, 0);
  const budget = await (db.from("runs").select("count") as any)
    .eq("team", "HACK")
    .neq("status", "error")
    .gte("started_at", day.toISOString());
  check("gte/neq budget query", !budget.error && budget.data.some((r: any) => r.count === 3), budget.error);

  // ---- in() over uuids (seed lineage pattern) ----
  const byIds = await (db.from("mcqs").select("id,index") as any).in("id", sel.data.map((m: any) => m.id));
  check("in() over uuids", !byIds.error && byIds.data.length === 3, byIds.error);

  // ---- range pagination (seed pool pattern) ----
  const page = await (db.from("mcqs").select("index") as any).eq("run_id", runId).order("index", { ascending: true }).range(1, 2);
  check("range pagination", !page.error && page.data.length === 2 && page.data[0].index === 1, page.error);

  // ---- single / maybeSingle ----
  const one = await (db.from("runs").select("*") as any).eq("id", runId).single();
  check("single", !one.error && one.data.id === runId, one.error);
  const none = await (db.from("runs").select("*") as any).eq("id", "00000000-0000-0000-0000-000000000000").maybeSingle();
  check("maybeSingle empty", !none.error && none.data === null, none.error);

  // ---- upsert ignoreDuplicates (tag_items pattern) ----
  const tag = await (db.from("tags").insert({ team: "HACK", name: `smoke-${runId.slice(0, 8)}` }) as any).select().single();
  check("insert tag returning", !tag.error && tag.data?.id, tag.error);
  const item = { tag_id: tag.data.id, item_type: "run", item_id: runId };
  const up1 = await db.from("tag_items").upsert(item as any, { onConflict: "tag_id,item_type,item_id", ignoreDuplicates: true });
  const up2 = await db.from("tag_items").upsert(item as any, { onConflict: "tag_id,item_type,item_id", ignoreDuplicates: true });
  check("upsert ignoreDuplicates idempotent", !(up1 as any).error && !(up2 as any).error, (up2 as any).error);
  const items = await (db.from("tag_items").select("id", { count: "exact", head: true }) as any).eq("tag_id", tag.data.id);
  check("upsert produced exactly one row", items.count === 1, items.count);

  // ---- rpc match_plag_trgm ----
  await db.from("plag_corpus").insert({
    source: "smoke",
    url: `http://smoke/${runId}`,
    question: "What is the time complexity of binary search on a sorted array?",
    question_norm: "what is the time complexity of binary search on a sorted array?",
  });
  const rpc = await db.rpc("match_plag_trgm", {
    query_text: "What is the time complexity of binary search on a sorted array?",
    match_count: 5,
    filter_language: null,
  });
  check("rpc match_plag_trgm", !rpc.error && rpc.data?.length >= 1 && rpc.data[0].similarity > 0.9, rpc.error ?? rpc.data);

  // ---- unfiltered update/delete are refused ----
  const guard = await (db.from("runs").update({ status: "x" }) as any);
  check("unfiltered update refused", !!guard.error, guard.error?.message);

  // ---- delete with filter (cleanup; cascades mcqs + run_events) ----
  const delItems = await (db.from("tag_items").delete() as any).eq("tag_id", tag.data.id);
  const delTag = await (db.from("tags").delete() as any).eq("id", tag.data.id);
  const delCorpus = await (db.from("plag_corpus").delete() as any).eq("url", `http://smoke/${runId}`);
  const delRun = await (db.from("runs").delete() as any).eq("id", runId);
  check("deletes", ![delItems, delTag, delCorpus, delRun].some((d) => d.error), [delItems.error, delTag.error, delCorpus.error, delRun.error]);
  const gone = await (db.from("mcqs").select("id", { count: "exact", head: true }) as any).eq("run_id", runId);
  check("cascade delete", gone.count === 0, gone.count);

  await pgPool().end();
  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
