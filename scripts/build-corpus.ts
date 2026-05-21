/**
 * Build the `plag_corpus` table by scraping public MCQ sites and inserting
 * normalized question text. No embeddings — plag check uses pg_trgm +
 * fuzzball at query time.
 *
 * Run with: `npm run build:corpus`
 *
 * v1 sources:
 *   - Sanfoundry — sanfoundry.com/<topic>-questions-answers/
 *
 * Easy to extend: add another scraper to SCRAPERS below.
 * Each scraper yields { source, url, topic, language, question, code? } objects.
 */
import { config as dotenvConfig } from "dotenv";
dotenvConfig({ path: ".env.local" });
dotenvConfig({ path: ".env" });
import { createClient } from "@supabase/supabase-js";
import * as cheerio from "cheerio";

const BATCH = 200;            // rows per insert
const PAGE_DELAY_MS = 600;    // be polite

interface ScrapedQuestion {
  source: string;
  url: string;
  topic: string | null;
  language: string | null;
  question: string;
  code: string | null;
}

// -----------------------------------------------------------------------------
// Source: Sanfoundry — index page lists per-topic question pages.
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
function normalize(q: string): string {
  return q.toLowerCase().replace(/\s+/g, " ").trim();
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SECRET_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error("set NEXT_PUBLIC_SUPABASE_URL and a key (SUPABASE_SECRET_KEY / SERVICE_ROLE_KEY / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)");
  }
  const supa = createClient(url, key, { auth: { persistSession: false } });

  let buffer: ScrapedQuestion[] = [];
  let totalInserted = 0;

  const flush = async () => {
    if (buffer.length === 0) return;
    const rows = buffer.map((b) => ({
      source: b.source,
      url: b.url,
      topic: b.topic,
      language: b.language,
      question: b.question,
      question_norm: normalize(b.question),
      code: b.code,
    }));
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
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
