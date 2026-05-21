/**
 * Build the `plag_corpus` table by scraping public MCQ sites, embedding each
 * question with Voyage, and inserting into Supabase.
 *
 * Run with: `npm run build:corpus`
 *
 * v1 sources:
 *   - Sanfoundry — sanfoundry.com/<topic>-questions-answers/
 *
 * Easy to extend with more sources: add another scraper to SCRAPERS below.
 * Each scraper yields { source, url, topic, language, question, code? } objects.
 *
 * Cost estimate: ~$1.50 in Voyage embeddings for ~50k questions.
 */
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import * as cheerio from "cheerio";

const VOYAGE_API = "https://api.voyageai.com/v1/embeddings";
const VOYAGE_MODEL = process.env.VOYAGE_EMBEDDING_MODEL ?? "voyage-3";
const BATCH = 50;       // embeddings per Voyage call
const PAGE_DELAY_MS = 600;  // be polite

interface ScrapedQuestion {
  source: string;
  url: string;
  topic: string | null;
  language: string | null;
  question: string;
  code: string | null;
}

// -----------------------------------------------------------------------------
// Source: Sanfoundry — example topic pages. Extend SANFOUNDRY_PAGES as needed.
// -----------------------------------------------------------------------------
const SANFOUNDRY_INDEX = "https://www.sanfoundry.com/1000-python-questions-answers/";

async function fetchHtml(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; MCQ-Corpus-Builder/1.0)" },
  });
  if (!res.ok) throw new Error(`fetch ${url}: ${res.status}`);
  return res.text();
}

async function* scrapeSanfoundry(): AsyncGenerator<ScrapedQuestion> {
  // The index page lists per-topic question pages.
  const index = await fetchHtml(SANFOUNDRY_INDEX);
  const $ = cheerio.load(index);
  const links: string[] = [];
  $("a").each((_, el) => {
    const href = $(el).attr("href") ?? "";
    if (/sanfoundry\.com\/[a-z0-9-]+-questions-answers-[a-z0-9-]+\//i.test(href)) {
      links.push(href);
    }
  });
  const unique = [...new Set(links)];
  console.log(`Sanfoundry: ${unique.length} topic pages discovered`);

  for (const url of unique) {
    try {
      const html = await fetchHtml(url);
      const d = cheerio.load(html);
      const topic = d("h1").first().text().trim() || null;
      const language = inferLanguage(url, topic ?? "");

      // Collect inside the cheerio callback, then yield outside (you can't
      // yield from a non-generator callback).
      const pageItems: ScrapedQuestion[] = [];
      d("p, li").each((_, el) => {
        const text = d(el).text().trim();
        const m = text.match(/^\s*\d+[.)]\s*(.+\?)/);
        if (!m) return;
        const question = m[1].trim();
        if (question.length < 20) return;
        const code = d(el).find("pre").text().trim() || null;
        pageItems.push({ source: "sanfoundry", url, topic, language, question, code });
      });
      for (const item of pageItems) yield item;
      await new Promise((r) => setTimeout(r, PAGE_DELAY_MS));
    } catch (e) {
      console.warn(`  skip ${url}: ${(e as Error).message}`);
    }
  }
}

function inferLanguage(url: string, topic: string): string | null {
  const t = (url + " " + topic).toLowerCase();
  if (t.includes("python")) return "python";
  if (t.includes("java") && !t.includes("javascript")) return "java";
  if (t.includes("javascript") || t.includes("js")) return "javascript";
  if (t.includes("c++") || t.includes("cpp")) return "cpp";
  if (t.includes("c#") || t.includes("csharp")) return "csharp";
  if (t.includes("html")) return "html";
  if (t.includes("css")) return "css";
  if (/\bc\b/.test(t)) return "c";
  return null;
}

const SCRAPERS: (() => AsyncGenerator<ScrapedQuestion>)[] = [
  scrapeSanfoundry,
  // add scrapeIndiabix, scrapeJavaTpoint, scrapeGeeksForGeeks here
];

// -----------------------------------------------------------------------------
// Embedding + insertion
// -----------------------------------------------------------------------------
async function embedBatch(texts: string[]): Promise<number[][]> {
  const res = await fetch(VOYAGE_API, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.VOYAGE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      input: texts,
      model: VOYAGE_MODEL,
      input_type: "document",
      truncation: true,
    }),
  });
  if (!res.ok) throw new Error(`Voyage: ${res.status} ${await res.text()}`);
  const json = await res.json();
  return (json.data as { embedding: number[] }[]).map((d) => d.embedding);
}

function normalize(q: string): string {
  return q.toLowerCase().replace(/\s+/g, " ").trim();
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
  if (!process.env.VOYAGE_API_KEY) throw new Error("set VOYAGE_API_KEY");
  const supa = createClient(url, key, { auth: { persistSession: false } });

  let buffer: ScrapedQuestion[] = [];
  let totalInserted = 0;

  const flush = async () => {
    if (buffer.length === 0) return;
    const texts = buffer.map((b) => b.question);
    const vectors = await embedBatch(texts);

    const rows = buffer.map((b, i) => ({
      source: b.source,
      url: b.url,
      topic: b.topic,
      language: b.language,
      question: b.question,
      question_norm: normalize(b.question),
      code: b.code,
      embedding: vectors[i],
    }));

    // upsert on (source, url) — but our unique constraint is on that pair, and
    // a single page yields many questions per url. Switch to plain insert and
    // tolerate duplicates by ignoring the conflict.
    const { error } = await supa.from("plag_corpus").insert(rows);
    if (error && !/duplicate key/i.test(error.message)) {
      throw new Error(`insert: ${error.message}`);
    }
    totalInserted += rows.length;
    console.log(`  ...inserted ${rows.length} (total ${totalInserted})`);
    buffer = [];
  };

  for (const scraper of SCRAPERS) {
    for await (const item of scraper()) {
      buffer.push(item);
      if (buffer.length >= BATCH) await flush();
    }
  }
  await flush();

  console.log(`\nDone. ${totalInserted} corpus rows inserted.`);
  console.log(`Run "ANALYZE plag_corpus;" in Supabase SQL editor to refresh the ivfflat index.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
