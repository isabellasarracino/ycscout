"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { fetchJson } from "@/lib/fetchJson";

interface Founder { name: string; title?: string | null; linkedin?: string | null; twitter?: string | null }
interface Company {
  slug: string; name: string; one_liner: string; long_description: string;
  website?: string | null; yc_url?: string | null; founders: Founder[];
}
interface Evaluation {
  company_slug: string; quality_score: number; thesis_score: number;
  quality_rationale: string; team_assessment: string; thesis_rationale: string;
  matched_themes: string[];
}
interface ReportData {
  batch_name: string; total_companies: number; total_evaluated: number;
  companies: Record<string, Company>;
  quality_flags: Evaluation[]; thesis_flags: Evaluation[];
}

function CompanyCard({ c, ev }: { c: Company; ev: Evaluation }) {
  return (
    <div className="card">
      <h3 style={{ margin: "0 0 6px" }}>{c.name} — {c.one_liner}</h3>
      <div className="scores">
        <span className="badge">Quality {ev.quality_score}/10</span>
        <span className="badge thesis">Thesis {ev.thesis_score}/10</span>
        {ev.matched_themes?.map((t) => <span key={t} className="badge theme">{t}</span>)}
      </div>
      <p>{c.long_description || <span className="empty">No description provided.</span>}</p>
      <div className="field"><b>Team:</b> {ev.team_assessment || <span className="empty">Not assessed.</span>}</div>
      {c.founders?.length > 0 && (
        <div className="field">
          <b>Founders:</b>{" "}
          {c.founders.map((f, i) => (
            <span key={i}>
              {f.name}{f.title ? ` — ${f.title}` : ""}
              {f.linkedin && <a href={f.linkedin} target="_blank" rel="noreferrer"> (LinkedIn)</a>}
              {i < c.founders.length - 1 ? "; " : ""}
            </span>
          ))}
        </div>
      )}
      <div className="field"><b>Why interesting:</b> {ev.quality_rationale || "—"}</div>
      {ev.thesis_rationale && <div className="field"><b>Thesis fit:</b> {ev.thesis_rationale}</div>}
      <div className="links">
        {c.website && <a href={c.website} target="_blank" rel="noreferrer">Website</a>}
        {c.yc_url && <a href={c.yc_url} target="_blank" rel="noreferrer">YC profile</a>}
      </div>
    </div>
  );
}

export default function ReportPage() {
  const params = useParams();
  const key = params.key as string;
  const [data, setData] = useState<ReportData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchJson(`/api/report/${key}`)
      .then(setData)
      .catch((e) => setError(e.message));
  }, [key]);

  if (error) return <div className="error-box">{error}</div>;
  if (!data) return <p className="empty">Loading...</p>;

  return (
    <div>
      <a href="/" style={{ color: "#4a6cf7", textDecoration: "none", fontSize: "0.9rem" }}>&larr; Dashboard</a>
      <h1>{data.batch_name} — Scouting Report</h1>
      <div className="meta">
        {data.total_evaluated} of {data.total_companies} companies evaluated ·
        {" "}{data.quality_flags.length} quality flags · {data.thesis_flags.length} thesis flags
      </div>

      <h2>Category A — Interesting &amp; well-qualified team</h2>
      <div className="meta">{data.quality_flags.length} companies</div>
      {data.quality_flags.length === 0 && <p className="empty">No companies cleared the quality bar yet.</p>}
      {data.quality_flags.map((ev) => (
        <CompanyCard key={ev.company_slug} c={data.companies[ev.company_slug]} ev={ev} />
      ))}

      <h2>Category B — Aligned with Activant&apos;s research thesis</h2>
      <div className="meta">{data.thesis_flags.length} companies</div>
      {data.thesis_flags.length === 0 && <p className="empty">No companies aligned with the thesis yet.</p>}
      {data.thesis_flags.map((ev) => (
        <CompanyCard key={ev.company_slug} c={data.companies[ev.company_slug]} ev={ev} />
      ))}
    </div>
  );
}
