import { NextResponse } from "next/server";
import { ensureSchema, getCompaniesByBatch, getEvaluationsByBatch, markBatchProcessed } from "@/lib/db";
import { fetchMeta } from "@/lib/yc";

export const dynamic = "force-dynamic";

export const maxDuration = 15;

// GET /api/report/[key] — assemble the two-category report for a batch from
// whatever is currently in the database. Marks the batch processed once every
// fetched company has an evaluation (so it's not re-flagged as "needs
// processing" on the dashboard).
export async function GET(_req: Request, { params }: { params: { key: string } }) {
  await ensureSchema();
  const meta = await fetchMeta();
  const info = meta.batches[params.key];
  if (!info) {
    return NextResponse.json({ error: `Batch '${params.key}' not found.` }, { status: 404 });
  }

  const companies = await getCompaniesByBatch(info.name);
  const evaluations = await getEvaluationsByBatch(info.name);
  const evalBySlug = Object.fromEntries(evaluations.map((e) => [e.company_slug, e]));

  const companiesWithEval = companies.filter((c) => evalBySlug[c.slug]);
  if (companies.length > 0 && companiesWithEval.length === companies.length) {
    await markBatchProcessed(params.key, info.count);
  }

  const qualityFlags = evaluations
    .filter((e) => e.flagged_quality)
    .sort((a, b) => b.quality_score - a.quality_score);
  const thesisFlags = evaluations
    .filter((e) => e.flagged_thesis)
    .sort((a, b) => b.thesis_score - a.thesis_score);

  return NextResponse.json({
    batch_key: params.key,
    batch_name: info.name,
    total_companies: companies.length,
    total_evaluated: evaluations.length,
    companies: Object.fromEntries(companies.map((c) => [c.slug, c])),
    quality_flags: qualityFlags,
    thesis_flags: thesisFlags,
  });
}
