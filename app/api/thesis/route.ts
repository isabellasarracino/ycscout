import { NextResponse } from "next/server";
import { ensureSchema, loadThesis, saveThesis } from "@/lib/db";
import { buildThesisProfile } from "@/lib/activant";

export const dynamic = "force-dynamic";

export const maxDuration = 60;

const THESIS_MODEL = "llama-3.3-70b-versatile";

export async function GET() {
  await ensureSchema();
  const thesis = await loadThesis();
  return NextResponse.json({ thesis });
}

export async function POST() {
  await ensureSchema();
  const thesis = await buildThesisProfile(THESIS_MODEL);
  await saveThesis(thesis);
  return NextResponse.json({ thesis });
}
