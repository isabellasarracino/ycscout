import { NextResponse } from "next/server";
import { ensureSchema, upsertCompany, getEvaluationsByBatch } from "@/lib/db";
import { fetchMeta, fetchBatchCompanies } from "@/lib/yc";

export const dynamic = "force-dynamic";

export const maxDuration = 30;

// POST /api/batches/[key]/load — fetch a batch's company list from yc-oss and
// store it. Fast (one JSON fetch + DB writes) so it fits well within
// serverless time limits. Founder/website enrichment and evaluation happen
// per-company afterwards (see /api/companies/[slug]/evaluate) so that a big
// batch never has to fit inside a single request.
export async function POST(_req: Request, { params }: { params: { key: string } }) {
  await ensureSchema();
  const meta = await fetchMeta();
  const info = meta.batches[params.key];
  if (!info) {
    return NextResponse.json({ error: `Batch '${params.key}' not found.` }, { status: 404 });
  }

  const companies = await fetchBatchCompanies(info.api);
  for (const c of companies) {
    await upsertCompany(c);
  }

  const existingEvals = await getEvaluationsByBatch(info.name);
  const evaluatedSlugs = new Set(existingEvals.map((e) => e.company_slug));

  return NextResponse.json({
    batch_key: params.key,
    batch_name: info.name,
    companies: companies.map((c) => ({
      slug: c.slug,
      name: c.name,
      one_liner: c.one_liner,
      already_evaluated: evaluatedSlugs.has(c.slug),
    })),
  });
}
