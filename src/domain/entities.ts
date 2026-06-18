// Row types for the tables in supabase/migrations/0001_mvp_schema.sql. These
// model the persisted shape; service inputs and API payloads live alongside.

export type JobStatus =
  | "pending"
  | "researching"
  | "building"
  | "publishing"
  | "done"
  | "failed";

export interface Organization {
  id: string;
  name: string;
  slug: string;
  created_at: string;
  updated_at: string;
}

export interface Membership {
  org_id: string;
  user_id: string;
  role: string;
  created_at: string;
}

export interface ProofPoint {
  claim: string;
  source?: string;
}

export interface Brand {
  primary_color?: string;
  logo_url?: string;
  [key: string]: unknown;
}

export interface ProductProfile {
  org_id: string;
  company_name: string;
  product_name: string;
  value_prop: string;
  positioning: string | null;
  proof_points: ProofPoint[] | null;
  cta_text: string | null;
  brand: Brand | null;
  created_at: string;
  updated_at: string;
}

// The columns the precondition gate checks for non-null (mvp-pipeline-architecture
// Precondition Gate; mvp-data-model Product Profile).
export const REQUIRED_PROFILE_FIELDS = [
  "company_name",
  "product_name",
  "value_prop",
] as const;

export interface LeadBatch {
  id: string;
  org_id: string;
  source: string | null;
  created_at: string;
}

export interface Lead {
  id: string;
  org_id: string;
  batch_id: string | null;
  first_name: string;
  last_name: string;
  role: string | null;
  company: string;
  website_url: string | null;
  email: string | null;
  custom_fields: Record<string, unknown> | null;
  created_at: string;
}

export interface Job {
  id: string;
  org_id: string;
  lead_id: string;
  batch_id: string | null;
  status: JobStatus;
  research_id: string | null;
  html_s3_key: string | null;
  site_url: string | null;
  failure_reason: string | null;
  attempts: number;
  lease_until: string | null;
  created_at: string;
  updated_at: string;
}

export interface ResearchRow {
  id: string;
  job_id: string;
  org_id: string;
  payload: unknown;
  created_at: string;
}

// API input shape for a single submitted lead (POST /leads).
export interface LeadInput {
  first_name: string;
  last_name: string;
  role?: string;
  company: string;
  website_url?: string;
  email?: string;
  custom_fields?: Record<string, unknown>;
}
