// Lead Service. Validates the precondition, creates one job per submitted lead,
// returns the leadId -> jobId map, and serves status reads (mvp-pipeline-
// architecture Service Topology; D15 batch submit; D34 dedupe; D44 regenerate).

import {
  createJob,
  createLeadBatch,
  findActiveJobByEmail,
  getJob,
  getLead,
  insertLead,
} from "../db/client.ts";
import type { Job, JobStatus, LeadInput } from "../domain/entities.ts";
import { isProfileComplete, missingRequiredFields } from "./personalization.ts";
import { getProfile } from "./personalization.ts";

export class ProfileIncompleteError extends Error {
  constructor(public readonly missing: string[]) {
    super(`product profile incomplete: ${missing.join(", ")}`);
    this.name = "ProfileIncompleteError";
  }
}

export class LeadNotFoundError extends Error {
  constructor(leadId: string) {
    super(`lead not found: ${leadId}`);
    this.name = "LeadNotFoundError";
  }
}

// One create submission carries many leads. One regenerate references an existing
// lead by id (D44). The request body disambiguates by the presence of regenerate.
export interface SubmitRequest {
  leads?: LeadInput[];
  source?: string;
  regenerate?: boolean;
  lead_id?: string; // required when regenerate is true
}

export interface SubmitResponse {
  batchId: string | null;
  map: Record<string, string>; // leadId -> jobId
}

export interface JobStatusView {
  status: JobStatus;
  url: string | null;
  failureReason: string | null;
}

function isNonEmpty(value: string | undefined | null): value is string {
  return typeof value === "string" && value.trim() !== "";
}

// Submit leads (create) or rebuild one lead (regenerate). Always returns the
// leadId -> jobId map (D15). Rejects up front when the profile is incomplete (D14).
export async function submit(orgId: string, req: SubmitRequest): Promise<SubmitResponse> {
  if (req.regenerate) return regenerate(orgId, req);

  const leads = req.leads ?? [];
  if (leads.length === 0) throw new Error("submit requires at least one lead");

  // Precondition gate: a complete profile must exist before any lead spends cost.
  if (!(await isProfileComplete(orgId))) {
    const profile = await getProfile(orgId);
    throw new ProfileIncompleteError(missingRequiredFields(profile));
  }

  const batch = await createLeadBatch(orgId, req.source ?? "api");
  const map: Record<string, string> = {};

  for (const input of leads) {
    const lead = await insertLead({
      org_id: orgId,
      batch_id: batch.id,
      first_name: input.first_name,
      last_name: input.last_name,
      role: input.role ?? null,
      company: input.company,
      website_url: input.website_url ?? null,
      email: input.email ?? null,
      custom_fields: input.custom_fields ?? null,
    });

    // Submission-time dedupe on (org_id, email): if this email already has an
    // active or completed job, reuse it rather than spending twice (D34). A lead
    // with no email always gets a fresh job (nothing to dedupe on). The dedupe
    // checks jobs created before this lead row, so the fresh insert never matches
    // itself (it has no job yet). Map the new lead to the reused job id.
    let job: Job | null = null;
    if (isNonEmpty(input.email)) {
      job = await findActiveJobByEmail(orgId, input.email);
    }
    if (!job) job = await createJob({ org_id: orgId, lead_id: lead.id, batch_id: batch.id });

    map[lead.id] = job.id;
  }

  return { batchId: batch.id, map };
}

// Regenerate forces a fresh job for an existing lead, bypassing the dedupe (D44).
async function regenerate(orgId: string, req: SubmitRequest): Promise<SubmitResponse> {
  if (!isNonEmpty(req.lead_id)) {
    throw new Error("regenerate requires lead_id");
  }
  const lead = await getLead(orgId, req.lead_id);
  if (!lead) throw new LeadNotFoundError(req.lead_id);

  // The profile must still be complete to rebuild a meaningful page.
  if (!(await isProfileComplete(orgId))) {
    const profile = await getProfile(orgId);
    throw new ProfileIncompleteError(missingRequiredFields(profile));
  }

  const job = await createJob({ org_id: orgId, lead_id: lead.id, batch_id: lead.batch_id });
  return { batchId: lead.batch_id, map: { [lead.id]: job.id } };
}

// Status read for the client poll loop. Scoped to org_id (mvp-pipeline-architecture
// Request Flow). Returns the URL once the job is done.
export async function jobStatus(orgId: string, jobId: string): Promise<JobStatusView | null> {
  const job = await getJob(orgId, jobId);
  if (!job) return null;
  return { status: job.status, url: job.site_url, failureReason: job.failure_reason };
}
