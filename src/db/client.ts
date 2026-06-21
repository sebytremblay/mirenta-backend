// Thin typed facade over supabase-js. Every tenant-scoped read and write passes
// org_id explicitly: the MVP enforces isolation in application code, not RLS
// (D30). The facade keeps that discipline in one place and gives the services
// and worker a small, intention-revealing surface.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { config } from "../config/env.ts";
import type {
  Job,
  JobStatus,
  Lead,
  LeadBatch,
  Membership,
  Organization,
  ProductProfile,
  ResearchRow,
  TokenUsage,
} from "../domain/entities.ts";

let client: SupabaseClient | null = null;

export function db(): SupabaseClient {
  if (!client) {
    client = createClient(config.supabase.url, config.supabase.key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return client;
}

// Wrap a PostgREST response, throwing a clear error on failure. supabase-js
// returns { data, error } rather than rejecting, so every call funnels here.
function unwrap<T>(label: string, res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(`${label}: ${res.error.message}`);
  if (res.data === null) throw new Error(`${label}: no data returned`);
  return res.data;
}

// Sibling of unwrap for reads that may legitimately match no row (maybeSingle).
// Throws on a query error but passes a null result straight through.
function unwrapMaybe<T>(
  label: string,
  res: { data: T | null; error: { message: string } | null },
): T | null {
  if (res.error) throw new Error(`${label}: ${res.error.message}`);
  return res.data;
}

// Organizations and membership -------------------------------------------------

export async function createOrganization(name: string, slug: string): Promise<Organization> {
  const res = await db().from("organizations").insert({ name, slug }).select().single();
  return unwrap<Organization>("createOrganization", res);
}

export async function addMembership(
  orgId: string,
  userId: string,
  role = "owner",
): Promise<Membership> {
  const res = await db()
    .from("memberships")
    .insert({ org_id: orgId, user_id: userId, role })
    .select()
    .single();
  return unwrap<Membership>("addMembership", res);
}

// Resolve the caller's single org from membership (D39: one org per user).
export async function resolveOrgIdForUser(userId: string): Promise<string | null> {
  const res = await db()
    .from("memberships")
    .select("org_id")
    .eq("user_id", userId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  const row = unwrapMaybe<{ org_id: string }>("resolveOrgIdForUser", res);
  return row ? row.org_id : null;
}

// Product profile --------------------------------------------------------------

export async function getProductProfile(orgId: string): Promise<ProductProfile | null> {
  const res = await db().from("product_profiles").select("*").eq("org_id", orgId).maybeSingle();
  return unwrapMaybe<ProductProfile>("getProductProfile", res);
}

export async function upsertProductProfile(
  profile: Partial<ProductProfile> & { org_id: string },
): Promise<ProductProfile> {
  const res = await db()
    .from("product_profiles")
    .upsert(profile, { onConflict: "org_id" })
    .select()
    .single();
  return unwrap<ProductProfile>("upsertProductProfile", res);
}

// Leads and batches -------------------------------------------------------------

export async function createLeadBatch(orgId: string, source: string): Promise<LeadBatch> {
  const res = await db()
    .from("lead_batches")
    .insert({ org_id: orgId, source })
    .select()
    .single();
  return unwrap<LeadBatch>("createLeadBatch", res);
}

export async function insertLead(lead: Omit<Lead, "id" | "created_at">): Promise<Lead> {
  const res = await db().from("leads").insert(lead).select().single();
  return unwrap<Lead>("insertLead", res);
}

export async function getLead(orgId: string, leadId: string): Promise<Lead | null> {
  const res = await db()
    .from("leads")
    .select("*")
    .eq("org_id", orgId)
    .eq("id", leadId)
    .maybeSingle();
  return unwrapMaybe<Lead>("getLead", res);
}

// Jobs --------------------------------------------------------------------------

export async function createJob(input: {
  org_id: string;
  lead_id: string;
  batch_id: string | null;
}): Promise<Job> {
  const res = await db()
    .from("jobs")
    .insert({ ...input, status: "pending" })
    .select()
    .single();
  return unwrap<Job>("createJob", res);
}

export async function getJob(orgId: string, jobId: string): Promise<Job | null> {
  const res = await db()
    .from("jobs")
    .select("*")
    .eq("org_id", orgId)
    .eq("id", jobId)
    .maybeSingle();
  return unwrapMaybe<Job>("getJob", res);
}

// Submission-time dedupe (D34): the most recent active or done job belonging to
// any lead in this org that carries the given email. Joins jobs to leads so a
// double-submit of the same email reuses the existing job rather than spending
// twice. Returns null when no such job exists.
export async function findActiveJobByEmail(orgId: string, email: string): Promise<Job | null> {
  const res = await db()
    .from("jobs")
    .select("*, leads!inner(email)")
    .eq("org_id", orgId)
    .eq("leads.email", email)
    .in("status", ["pending", "researching", "building", "publishing", "done"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const row = unwrapMaybe<Job & { leads?: unknown }>("findActiveJobByEmail", res);
  if (!row) return null;
  // Strip the joined leads column the embed adds; callers want a plain Job.
  const { leads: _embedded, ...job } = row;
  return job as Job;
}

// Claim due jobs atomically through the SECURITY DEFINER RPC (0002_claim_jobs).
export async function claimJobs(batchSize: number, leaseSeconds: number): Promise<Job[]> {
  const res = await db().rpc("claim_jobs", {
    batch_size: batchSize,
    lease_seconds: leaseSeconds,
  });
  if (res.error) throw new Error(`claimJobs: ${res.error.message}`);
  return (res.data as Job[]) ?? [];
}

// Guarded transition: advance only from the expected prior status, so an
// overlapping tick or a stale lease cannot double-apply a stage.
export async function updateJob(
  jobId: string,
  expectedStatus: JobStatus,
  patch: Partial<Job>,
): Promise<Job | null> {
  const res = await db()
    .from("jobs")
    .update(patch)
    .eq("id", jobId)
    .eq("status", expectedStatus)
    .select()
    .maybeSingle();
  return unwrapMaybe<Job>("updateJob", res);
}

// Research ----------------------------------------------------------------------

export async function insertResearch(input: {
  job_id: string;
  org_id: string;
  payload: unknown;
}): Promise<ResearchRow> {
  const res = await db().from("research").insert(input).select().single();
  return unwrap<ResearchRow>("insertResearch", res);
}

export async function getResearchForJob(jobId: string): Promise<ResearchRow | null> {
  const res = await db()
    .from("research")
    .select("*")
    .eq("job_id", jobId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return unwrapMaybe<ResearchRow>("getResearchForJob", res);
}

// Token usage ------------------------------------------------------------------

// Record one agent stage's token usage and computed cost (D33 precursor infra).
// The worker writes one row per stage per job, so the per-lead total sums the
// job's rows. Tenancy keys on org_id explicitly (D30).
export async function insertTokenUsage(
  input: Omit<TokenUsage, "id" | "created_at">,
): Promise<TokenUsage> {
  const res = await db().from("token_usage").insert(input).select().single();
  return unwrap<TokenUsage>("insertTokenUsage", res);
}
