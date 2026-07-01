import { completeJSON } from "./groq";
import { thesisPromptBlock } from "./activant";
import type { Company, Evaluation, ThesisProfile } from "./types";

const TRIAGE_SYSTEM =
  "You are a fast first-pass screener for a growth-equity firm scanning a new " +
  "Y Combinator batch. Given a company, rate how worthy it is of deeper analysis " +
  "on a 0-10 scale, considering novelty, market, and signs of a strong team. " +
  "Be decisive and brief. Respond ONLY with JSON.";

const EVAL_SYSTEM =
  "You are an investment analyst at Activant Capital evaluating a newly announced " +
  "Y Combinator company. You assess two things independently and honestly:\n" +
  "  (1) general quality: how interesting the company is AND whether the founding " +
  "team appears qualified to build it (domain expertise, prior startups/exits, " +
  "notable employers, technical depth, relevant background);\n" +
  "  (2) fit with Activant's current research thesis (provided).\n" +
  "Ground every judgement in the evidence given. Where founder evidence is thin, " +
  "say so rather than assuming. Respond ONLY with JSON.";

function describeCompany(c: Company): string {
  const parts = [
    `Name: ${c.name}`,
    `Batch: ${c.batch}`,
    `One-liner: ${c.one_liner}`,
    `Description: ${c.long_description}`,
    c.industry ? `Industry: ${c.industry}` : "",
    c.tags?.length ? `Tags: ${c.tags.join(", ")}` : "",
    c.all_locations ? `Location: ${c.all_locations}` : "",
    c.team_size ? `Team size: ${c.team_size}` : "",
    c.website ? `Website: ${c.website}` : "",
  ];
  if (c.founders?.length) {
    const lines = c.founders.map((f) => {
      let s = f.name + (f.title ? ` (${f.title})` : "");
      if (f.bio) s += `: ${f.bio}`;
      return s;
    });
    parts.push("Founders:\n  - " + lines.join("\n  - "));
  }
  if (c.website_text) parts.push(`Website content (excerpt):\n${c.website_text}`);
  return parts.filter(Boolean).join("\n");
}

export async function triage(model: string, c: Company): Promise<{ score: number; reason: string }> {
  const prompt = `Rate this company's worthiness of deeper analysis (0-10).

${describeCompany(c)}

Respond with JSON: {"score": <int 0-10>, "reason": "<one sentence>"}`;
  try {
    const data = await completeJSON<{ score: number; reason: string }>(
      model,
      TRIAGE_SYSTEM,
      prompt,
      300
    );
    return { score: Number(data.score) || 0, reason: data.reason || "" };
  } catch {
    // Fail open: on a triage error, let the company through to full evaluation.
    return { score: 10, reason: "triage-error-passthrough" };
  }
}

export async function evaluateCompany(
  model: string,
  c: Company,
  thesis: ThesisProfile,
  qualityThreshold: number,
  thesisThreshold: number
): Promise<Evaluation> {
  const prompt = `Evaluate the following company against both criteria.

=== COMPANY ===
${describeCompany(c)}

=== ${thesisPromptBlock(thesis)} ===

Return JSON with this exact shape:
{
  "quality_score": <int 1-10>,
  "team_assessment": "<2-4 sentences specifically on founder qualifications and fit to build this>",
  "quality_rationale": "<2-3 sentences on why the company is or isn't interesting>",
  "thesis_score": <int 1-10>,
  "matched_themes": ["<names of Activant themes this company fits, if any>"],
  "thesis_rationale": "<1-3 sentences explaining the thesis fit or lack thereof>"
}
Output ONLY the JSON.`;

  const data = await completeJSON<any>(model, EVAL_SYSTEM, prompt, 1200);
  const quality = Number(data.quality_score) || 0;
  const thesisScore = Number(data.thesis_score) || 0;

  return {
    company_slug: c.slug,
    company_name: c.name,
    batch: c.batch,
    quality_score: quality,
    quality_rationale: data.quality_rationale || "",
    team_assessment: data.team_assessment || "",
    thesis_score: thesisScore,
    thesis_rationale: data.thesis_rationale || "",
    matched_themes: data.matched_themes || [],
    flagged_quality: quality >= qualityThreshold,
    flagged_thesis: thesisScore >= thesisThreshold,
    model,
    evaluated_at: new Date().toISOString(),
  };
}
