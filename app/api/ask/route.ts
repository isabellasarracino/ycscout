import { NextResponse } from "next/server";
import { ensureSchema } from "@/lib/db";
import { answerQuestion } from "@/lib/ask";

export const dynamic = "force-dynamic";

export const maxDuration = 30;

export async function POST(req: Request) {
  await ensureSchema();
  const { question } = await req.json();
  if (!question || typeof question !== "string") {
    return NextResponse.json({ error: "Missing 'question' in request body." }, { status: 400 });
  }
  try {
    const answer = await answerQuestion(question);
    return NextResponse.json({ answer });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || String(err) }, { status: 500 });
  }
}
