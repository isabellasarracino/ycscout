import { completeText } from "./groq";
import { getCompaniesByBatch, getEvaluationsByBatch, searchCompanies } from "./db";
import { fetchMeta, normalizeBatchKey } from "./yc";
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

  // Read ONLY from the database — never fetch/enrich a batch live here. A
  // question shouldn't trigger loading 100+ companies from the network, which
  // is what caused request timeouts. If the batch isn't in the DB yet, we
  // return it as empty so the caller can tell the user to process it first.
  const companies = await getCompaniesByBatch(info.name);
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
    if (loaded.companies.length === 0) {
      contextParts.push(
        `Batch ${loaded.name} has not been processed yet in this app, so there is no ` +
        `data or evaluations for it. Tell the user to go to the dashboard and click ` +
        `"Process" on ${loaded.name} first, then ask again.`
      );
      continue;
    }
    const evaluations = await getEvaluationsByBatch(loaded.name);
    const evalBySlug = Object.fromEntries(evaluations.map((e) => [e.company_slug, e]));

    // Put evaluated companies first, sorted by their best score, so questions
    // about "best/top" companies get the most relevant rows even if the list
    // is long. Cap the number of rows to keep the prompt (and response) fast.
    const sorted = [...loaded.companies].sort((a, b) => {
      const ea = evalBySlug[a.slug];
      const eb = evalBySlug[b.slug];
      const sa = ea ? Math.max(ea.quality_score, ea.thesis_score) : -1;
      const sb = eb ? Math.max(eb.quality_score, eb.thesis_score) : -1;
      return sb - sa;
    });
    const lines = sorted.slice(0, 40).map((c) => summarizeCompany(c, evalBySlug[c.slug]));
    const note = sorted.length > 40 ? `\n(showing top 40 of ${sorted.length})` : "";
    contextParts.push(`Batch ${loaded.name} (${loaded.companies.length} companies):\n${lines.join("\n")}${note}`);
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
