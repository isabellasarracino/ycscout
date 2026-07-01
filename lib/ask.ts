import { completeText } from "./groq";
import { getCompaniesByBatch, getEvaluationsByBatch, searchCompanies, upsertCompany } from "./db";
import { fetchMeta, fetchBatchCompanies, normalizeBatchKey } from "./yc";
import type { Company, Evaluation } from "./types";

const QA_MODEL = "llama-3.3-70b-versatile";

const BATCH_TOKEN_RE = /\b((?:winter|summer|fall|spring)[\s-]?20\d{2}|[wsf]'?\d{2}|sp'?\d{2})\b/gi;

/** Pull anything that looks like a batch reference out of free text. */
function extractBatchTokens(question: string): string[] {
  const matches = question.match(BATCH_TOKEN_RE) || [];
  return Array.from(new Set(matches.map((m) => normalizeBatchKey(m))));
}

async function ensureBatchLoaded(batchKey: string): Promise<{ name: string; companies: Company[] } | null> {
  const meta = await fetchMeta();
  const info = meta.batches[batchKey];
  if (!info) return null;

  let companies = await getCompaniesByBatch(info.name);
  if (companies.length === 0) {
    companies = await fetchBatchCompanies(info.api);
    for (const c of companies) await upsertCompany(c);
  }
  return { name: info.name, companies };
}

function summarizeCompany(c: Company, ev: Evaluation | undefined): string {
  let s = `- ${c.name}: ${c.one_liner}`;
  if (c.founders?.length) {
    s += ` | Founders: ${c.founders.map((f) => f.name).join(", ")}`;
  }
  if (ev) {
    s += ` | Quality ${ev.quality_score}/10, Thesis ${ev.thesis_score}/10`;
    if (ev.matched_themes?.length) s += ` (${ev.matched_themes.join(", ")})`;
  } else {
    s += " | Not yet evaluated";
  }
  return s;
}

const SYSTEM = `You are Activant Capital's Y Combinator research assistant, answering questions
inside a web app. You are given whatever local catalogue data was found relevant to the
question below — treat it as ground truth. If the data needed to answer isn't present in
what's given to you, say so plainly rather than guessing. Never fabricate founder names,
scores, or figures. Be concise and specific. Note: this app has no live web access, so you
cannot look up financials, funding rounds, or news — say if that's what's being asked for.`;

export async function answerQuestion(question: string): Promise<string> {
  const contextParts: string[] = [];

  // 1. Any batch mentioned by name/key?
  const batchTokens = extractBatchTokens(question);
  for (const key of batchTokens) {
    const loaded = await ensureBatchLoaded(key);
    if (!loaded) {
      contextParts.push(`Batch "${key}" was not found in YC's directory.`);
      continue;
    }
    const evaluations = await getEvaluationsByBatch(loaded.name);
    const evalBySlug = Object.fromEntries(evaluations.map((e) => [e.company_slug, e]));
    const lines = loaded.companies.map((c) => summarizeCompany(c, evalBySlug[c.slug]));
    contextParts.push(`Batch ${loaded.name} (${loaded.companies.length} companies):\n${lines.join("\n")}`);
  }

  // 2. Keyword search for specific company mentions (skip if a batch already covered it).
  if (batchTokens.length === 0) {
    const words = question
      .replace(/[^\w\s-]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 3);
    const tried = new Set<string>();
    for (const w of words.slice(0, 6)) {
      if (tried.has(w.toLowerCase())) continue;
      tried.add(w.toLowerCase());
      const matches = await searchCompanies(w, 5);
      if (matches.length) {
        const evalsFlat = await Promise.all(
          matches.map((c) => getEvaluationsByBatch(c.batch))
        );
        const evalBySlug = Object.fromEntries(
          evalsFlat.flat().map((e) => [e.company_slug, e])
        );
        for (const c of matches) {
          contextParts.push(summarizeCompany(c, evalBySlug[c.slug]));
        }
      }
    }
  }

  const context = contextParts.length
    ? contextParts.join("\n\n")
    : "No matching batch or company was found in the local catalogue for this question.";

  const prompt = `LOCAL CATALOGUE DATA:\n${context}\n\nQUESTION: ${question}`;
  return completeText(QA_MODEL, SYSTEM, prompt, 800);
}
