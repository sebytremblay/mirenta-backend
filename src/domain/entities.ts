// Row types for the tables in supabase/migrations/0001_mvp_schema.sql. These
// model the persisted shape; service inputs and API payloads live alongside.

// VerticalEconomics is the per-customer pricing/effectiveness shape the value
// model consumes. The type lives with the vertical seam; entities references it
// only for the profile's economics column. The import is type-only, so it erases
// at compile time and raises no runtime cycle with verticals (which reads
// ProductProfile back the same way).
import type { VerticalEconomics } from "../verticals/types.ts";

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
  // The customer's declared vertical: the VerticalSpec id the pipeline resolves
  // at runtime to research and render this customer's pages (src/verticals).
  // Defaults to the employee-service id at the column level (migration 0004).
  vertical: string;
  // Per-customer value-model economics (migration 0007). Null falls back to the
  // active vertical's defaultEconomics(), so existing rows keep Phase 1 behavior.
  // The vertical's createValueModel validates the shape before compute reads it.
  economics: VerticalEconomics | null;
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

// Which agent stage spent the tokens recorded on a token_usage row.
export type TokenUsageAgent = "research" | "builder";

// One token-usage telemetry row (supabase/migrations/0005_token_usage.sql). The
// worker writes one row per agent stage per job; the per-lead total sums a job's
// rows and the research-vs-builder breakdown reads off `agent`. Raw counts keep
// the granularity; `cost_usd` preserves the cost as it stood at write time.
export interface TokenUsage {
  id: string;
  org_id: string;
  job_id: string;
  lead_id: string;
  agent: TokenUsageAgent;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_creation_tokens: number;
  cache_read_tokens: number;
  request_count: number;
  cost_usd: number;
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
