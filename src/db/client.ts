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
  if (res.error) throw new Error(`resolveOrgIdForUser: ${res.error.message}`);
  return res.data ? (res.data as { org_id: string }).org_id : null;
}

// Product profile --------------------------------------------------------------

export async function getProductProfile(orgId: string): Promise<ProductProfile | null> {
  const res = await db().from("product_profiles").select("*").eq("org_id", orgId).maybeSingle();
  if (res.error) throw new Error(`getProductProfile: ${res.error.message}`);
  return res.data as ProductProfile | null;
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
  if (res.error) throw new Error(`getLead: ${res.error.message}`);
  return res.data as Lead | null;
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
  if (res.error) throw new Error(`getJob: ${res.error.message}`);
  return res.data as Job | null;
}

// Find an in-flight job for a lead, used by the submission-time dedupe (D34).
export async function findActiveJobForLead(orgId: string, leadId: string): Promise<Job | null> {
  const res = await db()
    .from("jobs")
    .select("*")
    .eq("org_id", orgId)
    .eq("lead_id", leadId)
    .in("status", ["pending", "researching", "building", "publishing", "done"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (res.error) throw new Error(`findActiveJobForLead: ${res.error.message}`);
  return res.data as Job | null;
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
  if (res.error) throw new Error(`updateJob: ${res.error.message}`);
  return res.data as Job | null;
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
  if (res.error) throw new Error(`getResearchForJob: ${res.error.message}`);
  return res.data as ResearchRow | null;
}
