import { NextResponse } from "next/server";
import {
  ensureSchema,
  getCompany,
  upsertCompany,
  getEvaluation,
  saveEvaluation,
  loadThesis,
  saveThesis,
} from "@/lib/db";
import { enrichCompany } from "@/lib/yc";
import { triage, evaluateCompany } from "@/lib/evaluate";
import { buildThesisProfile } from "@/lib/activant";

export const dynamic = "force-dynamic";

export const maxDuration = 60;

const TRIAGE_MODEL = "llama-3.1-8b-instant";
const EVAL_MODEL = "llama-3.3-70b-versatile";
const THESIS_MODEL = "llama-3.3-70b-versatile";
const TRIAGE_PASS_THRESHOLD = 4;
const QUALITY_THRESHOLD = 7;
const THESIS_THRESHOLD = 7;

// POST /api/companies/[slug]/evaluate — enrich (founders + website) and fully
// evaluate ONE company. Designed to be called once per company, in a loop,
// from the browser — each call does at most two Groq requests, comfortably
// inside a serverless function's time limit even on the free tier. If this
// company was already evaluated (e.g. a previous run got interrupted), it's
// returned as-is rather than re-billed.
export async function POST(_req: Request, { params }: { params: { slug: string } }) {
  await ensureSchema();

  const existing = await getEvaluation(params.slug);
  if (existing) {
    return NextResponse.json({ evaluation: existing, reused: true });
  }

  let company = await getCompany(params.slug);
  if (!company) {
    return NextResponse.json({ error: `Company '${params.slug}' not in catalogue.` }, { status: 404 });
  }

  if (!company.founders?.length || company.website_text === null) {
    company = await enrichCompany(company);
    await upsertCompany(company);
  }

  let thesis = await loadThesis();
  if (!thesis) {
    thesis = await buildThesisProfile(THESIS_MODEL);
    await saveThesis(thesis);
  }

  const { score, reason } = await triage(TRIAGE_MODEL, company);
  let evaluation;
  if (score < TRIAGE_PASS_THRESHOLD) {
    evaluation = {
      company_slug: company.slug,
      company_name: company.name,
      batch: company.batch,
      quality_score: score,
      quality_rationale: `Triaged out: ${reason}`,
      team_assessment: "",
      thesis_score: 0,
      thesis_rationale: "",
      matched_themes: [],
      flagged_quality: false,
      flagged_thesis: false,
      model: TRIAGE_MODEL,
      evaluated_at: new Date().toISOString(),
    };
  } else {
    evaluation = await evaluateCompany(
      EVAL_MODEL, company, thesis, QUALITY_THRESHOLD, THESIS_THRESHOLD
    );
  }

  await saveEvaluation(evaluation);
  return NextResponse.json({ evaluation, reused: false });
}
