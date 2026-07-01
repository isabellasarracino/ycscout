"use client";

import { useEffect, useState } from "react";
import { fetchJson } from "@/lib/fetchJson";

interface BatchRow {
  batch_key: string;
  name: string;
  company_count: number;
  processed_count: number | null;
  needs_processing: boolean;
}

interface ThesisTheme { name: string; summary: string; keywords: string[] }
interface Thesis { overview: string; themes: ThesisTheme[]; built_at: string }

// Delay between per-company evaluation calls. This is what keeps us under
// the free Groq tier's rate limit — each call already retries internally,
// but pacing them client-side avoids tripping the limit in the first place.
const EVAL_DELAY_MS = 3000;

export default function Dashboard() {
  const [batches, setBatches] = useState<BatchRow[] | null>(null);
  const [thesis, setThesis] = useState<Thesis | null>(null);
  const [loadingBatches, setLoadingBatches] = useState(false);
  const [buildingThesis, setBuildingThesis] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [processing, setProcessing] = useState<Record<string, { done: number; total: number }>>({});

  async function loadThesis() {
    try {
      const data = await fetchJson("/api/thesis");
      setThesis(data.thesis);
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function checkBatches() {
    setLoadingBatches(true);
    setError(null);
    try {
      const data = await fetchJson("/api/batches");
      setBatches(data.batches);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoadingBatches(false);
    }
  }

  async function buildThesis() {
    setBuildingThesis(true);
    setError(null);
    try {
      const data = await fetchJson("/api/thesis", { method: "POST" });
      setThesis(data.thesis);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBuildingThesis(false);
    }
  }

  async function processBatch(batchKey: string) {
    setError(null);
    try {
      const { companies } = await fetchJson(`/api/batches/${batchKey}/load`, { method: "POST" });

      const toEvaluate = companies.filter((c: any) => !c.already_evaluated);
      setProcessing((p) => ({ ...p, [batchKey]: { done: companies.length - toEvaluate.length, total: companies.length } }));

      for (const c of toEvaluate) {
        try {
          await fetchJson(`/api/companies/${c.slug}/evaluate`, { method: "POST" });
        } catch (e: any) {
          throw new Error(`Failed evaluating ${c.name}: ${e.message}`);
        }
        setProcessing((p) => ({
          ...p,
          [batchKey]: { done: (p[batchKey]?.done || 0) + 1, total: companies.length },
        }));
        await new Promise((res) => setTimeout(res, EVAL_DELAY_MS));
      }

      await checkBatches();
    } catch (e: any) {
      setError(e.message);
    }
  }

  useEffect(() => {
    loadThesis();
    checkBatches();
  }, []);

  return (
    <div>
      <h1>Activant YC Scout</h1>
      <div className="meta">Detects new YC batches, evaluates companies against Activant's thesis, and lets you ask questions.</div>

      {error && <div className="error-box">{error}</div>}

      <h2>Activant research thesis</h2>
      {thesis ? (
        <div className="card">
          <p style={{ marginTop: 0 }}>{thesis.overview}</p>
          <div className="scores">
            {thesis.themes.map((t) => (
              <span key={t.name} className="badge theme" title={t.summary}>{t.name}</span>
            ))}
          </div>
          <div className="meta" style={{ marginTop: 10, marginBottom: 0 }}>
            Built {new Date(thesis.built_at).toLocaleString()}
          </div>
        </div>
      ) : (
        <p className="empty">Not built yet.</p>
      )}
      <button className="secondary" onClick={buildThesis} disabled={buildingThesis}>
        {buildingThesis ? "Building..." : thesis ? "Refresh thesis" : "Build thesis"}
      </button>

      <h2>Batches</h2>
      <button onClick={checkBatches} disabled={loadingBatches} style={{ marginBottom: 16 }}>
        {loadingBatches ? "Checking..." : "Check for new batches"}
      </button>

      {batches === null && <p className="empty">Loading...</p>}
      {batches?.map((b) => {
        const prog = processing[b.batch_key];
        const isDone = b.processed_count !== null && b.processed_count >= b.company_count;
        return (
          <div className="batch-row" key={b.batch_key}>
            <div className="info">
              <strong>{b.name}</strong>
              {b.needs_processing && <span className="badge-new">needs processing</span>}
              <div className="status">
                {b.company_count} companies
                {b.processed_count !== null && ` · ${b.processed_count} processed`}
              </div>
              {prog && (
                <div style={{ marginTop: 8 }}>
                  <div className="progress-bar">
                    <div className="fill" style={{ width: `${(100 * prog.done) / Math.max(prog.total, 1)}%` }} />
                  </div>
                  <div className="status">{prog.done} / {prog.total} evaluated</div>
                </div>
              )}
            </div>
            <div className="actions">
              <button className="secondary" onClick={() => processBatch(b.batch_key)}>
                {isDone ? "Re-check" : "Process"}
              </button>
              <a href={`/report/${b.batch_key}`}>
                <button>View report</button>
              </a>
            </div>
          </div>
        );
      })}
    </div>
  );
}
