import * as cheerio from "cheerio";
import { completeJSON } from "./groq";
import { htmlToText } from "./yc";
import type { ThesisProfile, ThesisTheme } from "./types";

const RESEARCH_URL = "https://www.activantcapital.com/research";
const MAX_ARTICLES = 8;
const PER_ARTICLE_CHARS = 1500;
const MAX_CORPUS_CHARS = 10_000;

export interface ArticleRef {
  slug: string;
  title: string;
  url: string;
  date: string | null;
}

const NON_ARTICLE_SLUGS = new Set(["all"]);
const MONTH_DATE_RE =
  /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},\s+\d{4}\b/;

export function parseResearchIndex(html: string, baseUrl: string): ArticleRef[] {
  const $ = cheerio.load(html);
  const seen = new Map<string, ArticleRef>();

  $("a[href]").each((_, el) => {
    const href = $(el).attr("href") || "";
    const path = href.startsWith("http") ? new URL(href).pathname : href;
    const m = path.match(/^\/research\/([a-z0-9][a-z0-9-]+)$/i);
    if (!m) return;
    const slug = m[1].toLowerCase();
    if (NON_ARTICLE_SLUGS.has(slug) || seen.has(slug)) return;

    const title = $(el).text().trim() || slug.replace(/-/g, " ");
    const containerText = $(el).parent().text().trim();
    const dateMatch = containerText.match(MONTH_DATE_RE);

    seen.set(slug, {
      slug,
      title,
      url: new URL(path, baseUrl).toString(),
      date: dateMatch ? dateMatch[0] : null,
    });
  });

  return Array.from(seen.values());
}

export async function fetchResearchIndex(): Promise<ArticleRef[]> {
  const resp = await fetch(RESEARCH_URL, { cache: "no-store" });
  if (!resp.ok) throw new Error(`Failed to fetch Activant research index: ${resp.status}`);
  const html = await resp.text();
  return parseResearchIndex(html, "https://www.activantcapital.com");
}

export async function fetchArticleTexts(articles: ArticleRef[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  await Promise.all(
    articles.map(async (a) => {
      try {
        const resp = await fetch(a.url);
        if (resp.ok) out[a.slug] = htmlToText(await resp.text(), PER_ARTICLE_CHARS);
      } catch {
        /* skip failed article fetch */
      }
    })
  );
  return out;
}

const THESIS_SYSTEM =
  "You are a research analyst at Activant Capital, a global growth-equity firm that " +
  "partners with high-growth companies transforming commerce. You distil the firm's " +
  "published research into a crisp, structured statement of its investment thesis. " +
  "Be specific and grounded strictly in the provided article content — do not invent " +
  "themes the articles don't support.";

export async function buildThesisProfile(model: string): Promise<ThesisProfile> {
  const allArticles = await fetchResearchIndex();
  const subset = allArticles.slice(0, MAX_ARTICLES);
  const texts = await fetchArticleTexts(subset);

  let corpus = subset
    .filter((a) => texts[a.slug])
    .map((a) => `### ${a.title}${a.date ? `  (${a.date})` : ""}\n${texts[a.slug]}`)
    .join("\n\n");
  if (corpus.length > MAX_CORPUS_CHARS) corpus = corpus.slice(0, MAX_CORPUS_CHARS);

  const prompt = `Below are excerpts from Activant Capital's recent research articles.

Produce a JSON object describing Activant's current investment thesis with this exact shape:
{
  "overview": "2-4 sentence synthesis of Activant's overall thesis and where it is heading",
  "themes": [
    {
      "name": "short theme name",
      "summary": "1-2 sentences on what Activant believes here and why it's investable",
      "keywords": ["concrete", "terms", "and", "categories", "that", "signal", "this", "theme"]
    }
  ]
}

Aim for 6-12 themes that genuinely reflect the corpus. Output ONLY the JSON.

RESEARCH CORPUS:
${corpus}`;

  const data = await completeJSON<{ overview: string; themes: any[] }>(
    model,
    THESIS_SYSTEM,
    prompt,
    4096
  );

  const themes: ThesisTheme[] = (data.themes || []).map((t) => ({
    name: t.name || "Unnamed theme",
    summary: t.summary || "",
    keywords: t.keywords || [],
  }));

  return {
    overview: data.overview || "",
    themes,
    article_slugs: allArticles.map((a) => a.slug).sort(),
    built_at: new Date().toISOString(),
  };
}

export function thesisPromptBlock(t: ThesisProfile): string {
  const lines = [`ACTIVANT RESEARCH THESIS OVERVIEW:\n${t.overview}`, "", "THEMES:"];
  for (const theme of t.themes) {
    const kw = theme.keywords.length ? ` (keywords: ${theme.keywords.join(", ")})` : "";
    lines.push(`- ${theme.name}: ${theme.summary}${kw}`);
  }
  return lines.join("\n");
}
