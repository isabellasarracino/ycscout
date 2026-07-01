export interface Founder {
  name: string;
  title?: string | null;
  bio?: string | null;
  linkedin?: string | null;
  twitter?: string | null;
}

export interface Company {
  id: number;
  name: string;
  slug: string;
  batch: string; // human name, e.g. "Fall 2026"
  one_liner: string;
  long_description: string;
  website?: string | null;
  yc_url?: string | null;
  industry?: string | null;
  tags: string[];
  all_locations?: string | null;
  team_size?: number | null;
  founders: Founder[];
  website_text?: string | null;
}

export interface Evaluation {
  company_slug: string;
  company_name: string;
  batch: string;
  quality_score: number;
  quality_rationale: string;
  team_assessment: string;
  thesis_score: number;
  thesis_rationale: string;
  matched_themes: string[];
  flagged_quality: boolean;
  flagged_thesis: boolean;
  model: string;
  evaluated_at: string;
}

export interface ThesisTheme {
  name: string;
  summary: string;
  keywords: string[];
}

export interface ThesisProfile {
  overview: string;
  themes: ThesisTheme[];
  article_slugs: string[];
  built_at: string;
}

export interface BatchInfo {
  batch_key: string;
  name: string;
  company_count: number;
  processed_count: number | null;
}
