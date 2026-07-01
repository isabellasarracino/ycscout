import { NextResponse } from "next/server";
import { ensureSchema, getKnownBatches, recordBatchSeen } from "@/lib/db";
import { fetchMeta, diffBatches, batchSortKey } from "@/lib/yc";

export const dynamic = "force-dynamic";

export const maxDuration = 30;

// GET /api/batches — list every batch (live counts + local processed state),
// and which ones are "new" or "grown" and worth processing.
export async function GET() {
  await ensureSchema();
  const meta = await fetchMeta();
  const known = await getKnownBatches();

  const now = new Date().toISOString();
  for (const [key, info] of Object.entries(meta.batches)) {
    await recordBatchSeen(key, (info as any).name || key, Number((info as any).count || 0));
  }

  const refreshedKnown = await getKnownBatches();
  const changes = diffBatches(meta.batches, refreshedKnown, 10, 2025);

  const batches = Object.entries(meta.batches)
    .map(([key, info]: [string, any]) => ({
      batch_key: key,
      name: info.name || key,
      company_count: info.count,
      processed_count: refreshedKnown[key]?.processed_count ?? null,
      needs_processing: changes.some((c) => c.batch_key === key),
    }))
    .sort((a, b) => batchSortKey(b.batch_key) - batchSortKey(a.batch_key));

  return NextResponse.json({ batches, checked_at: now });
}
