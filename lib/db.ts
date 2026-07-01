import { neon } from "@neondatabase/serverless";
import type { Company, Evaluation, ThesisProfile, BatchInfo } from "./types";

// Vercel's Postgres integration (via Neon) injects DATABASE_URL automatically.
// Some older setups use POSTGRES_URL instead, so we accept either.
function connectionString(): string {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!url) {
    throw new Error(
      "No database connection string found. Add a Postgres database to your " +
      "Vercel project (Storage tab) — it sets DATABASE_URL automatically."
    );
  }
  return url;
}

function db() {
  return neon(connectionString());
}

// One-time schema setup. Called at the start of every API request, so it must
// tolerate being run concurrently by multiple requests at once — which is
// exactly what happens when the dashboard loads (it fetches the thesis and
// the batch list in parallel). Postgres's "CREATE TABLE IF NOT EXISTS" is
// NOT safe against two transactions racing to create the same table for the
// first time: both can pass the "doesn't exist yet" check before either
// commits, and the loser gets a duplicate-key error on Postgres's internal
// pg_type catalog (error code 23505) even though the end result — the table
// existing — is exactly what we wanted. So we run each statement and simply
// ignore that specific, benign race-condition error.
async function runDDL(sql: ReturnType<typeof neon>, statement: string) {
  try {
    await sql.query(statement);
  } catch (err: any) {
    if (err?.code === "23505") return; // benign: another request created it first
    throw err;
  }
}

export async function ensureSchema() {
  const sql = db();
  await runDDL(sql, `
    CREATE TABLE IF NOT EXISTS batches (
      batch_key TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      company_count INTEGER NOT NULL,
      processed_count INTEGER,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
  await runDDL(sql, `
    CREATE TABLE IF NOT EXISTS companies (
      slug TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      batch TEXT NOT NULL,
      data JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
  await runDDL(sql, `CREATE INDEX IF NOT EXISTS idx_companies_batch ON companies(batch)`);
  await runDDL(sql, `
    CREATE TABLE IF NOT EXISTS evaluations (
      company_slug TEXT PRIMARY KEY,
      batch TEXT NOT NULL,
      data JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
  await runDDL(sql, `CREATE INDEX IF NOT EXISTS idx_eval_batch ON evaluations(batch)`);
  await runDDL(sql, `
    CREATE TABLE IF NOT EXISTS thesis (
      id INTEGER PRIMARY KEY DEFAULT 1,
      data JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CHECK (id = 1)
    )`);
}

export async function getKnownBatches(): Promise<Record<string, BatchInfo>> {
  const sql = db();
  const rows = await sql.query(`SELECT * FROM batches`);
  const out: Record<string, BatchInfo> = {};
  for (const r of rows as any[]) {
    out[r.batch_key] = {
      batch_key: r.batch_key,
      name: r.name,
      company_count: r.company_count,
      processed_count: r.processed_count,
    };
  }
  return out;
}

export async function recordBatchSeen(batchKey: string, name: string, count: number) {
  const sql = db();
  await sql.query(
    `INSERT INTO batches (batch_key, name, company_count, updated_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (batch_key) DO UPDATE
       SET company_count = $3, name = $2, updated_at = now()`,
    [batchKey, name, count]
  );
}

export async function markBatchProcessed(batchKey: string, count: number) {
  const sql = db();
  await sql.query(
    `UPDATE batches SET processed_count = $2, updated_at = now() WHERE batch_key = $1`,
    [batchKey, count]
  );
}

export async function upsertCompany(c: Company) {
  const sql = db();
  const data = JSON.stringify(c);
  await sql.query(
    `INSERT INTO companies (slug, name, batch, data, updated_at)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (slug) DO UPDATE
       SET name = $2, batch = $3, data = $4, updated_at = now()`,
    [c.slug, c.name, c.batch, data]
  );
}

export async function getCompany(slug: string): Promise<Company | null> {
  const sql = db();
  const rows = await sql.query(`SELECT data FROM companies WHERE slug = $1`, [slug]);
  return rows[0] ? ((rows[0] as any).data as Company) : null;
}

export async function getCompaniesByBatch(batch: string): Promise<Company[]> {
  const sql = db();
  const rows = await sql.query(`SELECT data FROM companies WHERE batch = $1`, [batch]);
  return (rows as any[]).map((r) => r.data as Company);
}

export async function searchCompanies(query: string, limit = 15): Promise<Company[]> {
  const sql = db();
  const like = `%${query.toLowerCase()}%`;
  let rows = await sql.query(
    `SELECT data FROM companies WHERE lower(data::text) LIKE $1 LIMIT $2`,
    [like, limit]
  );
  if ((rows as any[]).length > 0) return (rows as any[]).map((r) => r.data as Company);

  // Fall back to a hyphen/space-normalized variant (batch keys are typed both ways).
  if (query.includes("-") || query.includes(" ")) {
    const alt = query.includes("-") ? query.replace(/-/g, " ") : query.replace(/ /g, "-");
    const altLike = `%${alt.toLowerCase()}%`;
    rows = await sql.query(
      `SELECT data FROM companies WHERE lower(data::text) LIKE $1 LIMIT $2`,
      [altLike, limit]
    );
    return (rows as any[]).map((r) => r.data as Company);
  }
  return [];
}

export async function countCompanies(): Promise<number> {
  const sql = db();
  const rows = await sql.query(`SELECT COUNT(*)::int AS n FROM companies`);
  return (rows[0] as any).n;
}

export async function saveEvaluation(ev: Evaluation) {
  const sql = db();
  const data = JSON.stringify(ev);
  await sql.query(
    `INSERT INTO evaluations (company_slug, batch, data, updated_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (company_slug) DO UPDATE
       SET batch = $2, data = $3, updated_at = now()`,
    [ev.company_slug, ev.batch, data]
  );
}

export async function getEvaluation(slug: string): Promise<Evaluation | null> {
  const sql = db();
  const rows = await sql.query(`SELECT data FROM evaluations WHERE company_slug = $1`, [slug]);
  return rows[0] ? ((rows[0] as any).data as Evaluation) : null;
}

export async function getEvaluationsByBatch(batch: string): Promise<Evaluation[]> {
  const sql = db();
  const rows = await sql.query(`SELECT data FROM evaluations WHERE batch = $1`, [batch]);
  return (rows as any[]).map((r) => r.data as Evaluation);
}

export async function loadThesis(): Promise<ThesisProfile | null> {
  const sql = db();
  const rows = await sql.query(`SELECT data FROM thesis WHERE id = 1`);
  return rows[0] ? ((rows[0] as any).data as ThesisProfile) : null;
}

export async function saveThesis(t: ThesisProfile) {
  const sql = db();
  const data = JSON.stringify(t);
  await sql.query(
    `INSERT INTO thesis (id, data, updated_at) VALUES (1, $1, now())
     ON CONFLICT (id) DO UPDATE SET data = $1, updated_at = now()`,
    [data]
  );
}
