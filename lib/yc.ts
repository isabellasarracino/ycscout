import * as cheerio from "cheerio";
import type { Company, Founder, BatchInfo } from "./types";

const META_URL = "https://yc-oss.github.io/api/meta.json";

export async function fetchMeta(): Promise<{ batches: Record<string, any> }> {
  const resp = await fetch(META_URL, { cache: "no-store" });
  if (!resp.ok) throw new Error(`Failed to fetch YC meta: ${resp.status}`);
  return resp.json();
}

export async function fetchBatchCompanies(apiUrl: string): Promise<Company[]> {
  const resp = await fetch(apiUrl, { cache: "no-store" });
  if (!resp.ok) throw new Error(`Failed to fetch batch companies: ${resp.status}`);
  const data = await resp.json();
  return data.map((d: any) => companyFromYcDict(d));
}

function companyFromYcDict(d: any): Company {
  return {
    id: d.id,
    name: d.name,
    slug: d.slug,
    batch: d.batch || "",
    one_liner: d.one_liner || "",
    long_description: d.long_description || "",
    website: d.website || null,
    yc_url: d.url || null,
    industry: d.industry || null,
    tags: d.tags || [],
    all_locations: d.all_locations || null,
    team_size: d.team_size || null,
    founders: [],
    website_text: null,
  };
}

/** Batch year, e.g. "fall-2026" -> 2026. */
export function batchYear(batchKey: string): number | null {
  const m = batchKey.match(/(19|20)\d{2}/);
  return m ? parseInt(m[0], 10) : null;
}

// YC's batches run Winter (Jan-Mar) -> Spring -> Summer (Jun-Aug) -> Fall (Sep-Dec)
// within a year. Alphabetical sorting of batch keys does NOT match this order
// (e.g. "winter" > "fall" alphabetically, but winter comes first in the year),
// so a real chronological sort needs this explicit season ranking.
const SEASON_ORDER: Record<string, number> = { winter: 0, spring: 1, summer: 2, fall: 3 };

/** A sortable number where higher = more recent, for genuine chronological ordering. */
export function batchSortKey(batchKey: string): number {
  const year = batchYear(batchKey) || 0;
  const seasonMatch = batchKey.match(/winter|spring|summer|fall/i);
  const season = seasonMatch ? SEASON_ORDER[seasonMatch[0].toLowerCase()] ?? 0 : 0;
  return year * 10 + season;
}

export interface BatchChange {
  batch_key: string;
  name: string;
  api_url: string;
  count: number;
  reason: "new" | "grew";
}

/** Pure diff: which batches need (re)processing, given what we already know. */
export function diffBatches(
  metaBatches: Record<string, any>,
  known: Record<string, BatchInfo>,
  minNewToReprocess: number,
  earliestAutoYear: number | null
): BatchChange[] {
  const changes: BatchChange[] = [];
  for (const [key, info] of Object.entries(metaBatches)) {
    const year = batchYear(key);
    if (earliestAutoYear !== null && (year === null || year < earliestAutoYear)) continue;

    const count = Number((info as any).count || 0);
    const apiUrl = (info as any).api || "";
    const name = (info as any).name || key;
    const prev = known[key];

    if (!prev) {
      changes.push({ batch_key: key, name, api_url: apiUrl, count, reason: "new" });
      continue;
    }
    if (prev.processed_count === null) {
      changes.push({ batch_key: key, name, api_url: apiUrl, count, reason: "new" });
    } else if (count - prev.processed_count >= minNewToReprocess) {
      changes.push({ batch_key: key, name, api_url: apiUrl, count, reason: "grew" });
    }
  }
  changes.sort((a, b) => batchSortKey(b.batch_key) - batchSortKey(a.batch_key));
  return changes;
}

/** Recursively search a decoded JSON blob for a non-empty "founders" list. */
function deepFindFounders(obj: any): any[] {
  if (obj && typeof obj === "object" && !Array.isArray(obj)) {
    if (Array.isArray(obj.founders) && obj.founders.length && typeof obj.founders[0] === "object") {
      return obj.founders;
    }
    for (const v of Object.values(obj)) {
      const found = deepFindFounders(v);
      if (found.length) return found;
    }
  } else if (Array.isArray(obj)) {
    for (const item of obj) {
      const found = deepFindFounders(item);
      if (found.length) return found;
    }
  }
  return [];
}

function founderFromYcDict(d: any): Founder {
  return {
    name: d.full_name || d.name || "Unknown",
    title: d.title || d.role || null,
    bio: d.founder_bio || d.bio || null,
    linkedin: d.linkedin_url || d.linkedin || null,
    twitter: d.twitter_url || d.twitter || null,
  };
}

/** Parse founders out of a YC profile page's embedded Inertia data-page JSON. */
export function parseFoundersFromHtml(html: string): Founder[] {
  const $ = cheerio.load(html);
  let blob: any = null;

  const app = $("[data-page]").first();
  if (app.length) {
    try {
      blob = JSON.parse(app.attr("data-page") || "{}");
    } catch {
      /* fall through to script scan */
    }
  }
  if (!blob) {
    $("script").each((_, el) => {
      if (blob) return;
      const text = $(el).html() || "";
      if (text.includes('"founders"')) {
        const m = text.match(/\{[\s\S]*"founders"[\s\S]*\}/);
        if (m) {
          try {
            blob = JSON.parse(m[0]);
          } catch {
            /* keep scanning */
          }
        }
      }
    });
  }
  if (!blob) return [];
  return deepFindFounders(blob).map(founderFromYcDict);
}

export function htmlToText(html: string, charBudget: number): string {
  const $ = cheerio.load(html);
  $("script, style, noscript, svg, header, footer, nav").remove();
  const text = $.root().text().replace(/\s+/g, " ").trim();
  return text.slice(0, charBudget);
}

/** Fetch a company's YC profile page and website, filling in founders/website_text. */
export async function enrichCompany(c: Company, websiteCharBudget = 4000): Promise<Company> {
  const tasks: Promise<void>[] = [];

  const ycUrl = c.yc_url || `https://www.ycombinator.com/companies/${c.slug}`;
  tasks.push(
    fetch(ycUrl)
      .then((r) => (r.ok ? r.text() : null))
      .then((html) => {
        if (html) c.founders = parseFoundersFromHtml(html);
      })
      .catch(() => {})
  );

  if (c.website) {
    tasks.push(
      fetch(c.website)
        .then((r) => (r.ok ? r.text() : null))
        .then((html) => {
          if (html) c.website_text = htmlToText(html, websiteCharBudget);
        })
        .catch(() => {})
    );
  }

  await Promise.all(tasks);
  return c;
}

/** Map free-form batch text ("S24", "Summer 2024") to a yc-oss key ("summer-2024"). */
export function normalizeBatchKey(text: string): string {
  const t = text.trim().toLowerCase();
  if (/^(winter|summer|fall|spring)-\d{4}$/.test(t)) return t;
  let m = t.match(/^(winter|summer|fall|spring)\s+(\d{4})$/);
  if (m) return `${m[1]}-${m[2]}`;
  m = t.match(/^(sp|w|s|f)'?(\d{2})$/);
  if (m) {
    const seasons: Record<string, string> = { w: "winter", s: "summer", f: "fall", sp: "spring" };
    return `${seasons[m[1]]}-20${m[2]}`;
  }
  return t.replace(/\s+/g, "-");
}
