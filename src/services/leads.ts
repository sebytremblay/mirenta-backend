import {
  createJob,
  createLeadBatch,
  findActiveJobByEmail,
  getJob,
  getLead,
  insertLead,
} from "../db/client.ts";
import type { JobStatus, LeadInput } from "../domain/entities.ts";
import { isProfileComplete, missingRequiredFields } from "./personalization.ts";
import { getProfile } from "./personalization.ts";

export class ProfileIncompleteError extends Error {
  readonly missing: string[];
  constructor(missing: string[]) {
    super(`product profile incomplete: ${missing.join(", ")}`);
    this.name = "ProfileIncompleteError";
    this.missing = missing;
  }
}

export class LeadNotFoundError extends Error {
  constructor(leadId: string) {
    super(`lead not found: ${leadId}`);
    this.name = "LeadNotFoundError";
  }
}

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

export async function submit(orgId: string, req: SubmitRequest): Promise<SubmitResponse> {
  if (req.regenerate) return regenerate(orgId, req);

  const leads = req.leads ?? [];
  if (leads.length === 0) throw new Error("submit requires at least one lead");

  if (!(await isProfileComplete(orgId))) {
    const profile = await getProfile(orgId);
    throw new ProfileIncompleteError(missingRequiredFields(profile));
  }

  const batch = await createLeadBatch(orgId, req.source ?? "api");
  const map: Record<string, string> = {};

  for (const input of leads) {
    if (isNonEmpty(input.email)) {
      const existing = await findActiveJobByEmail(orgId, input.email);
      if (existing) {
        map[existing.lead_id] = existing.id;
        continue;
      }
    }

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
    const job = await createJob({ org_id: orgId, lead_id: lead.id, batch_id: batch.id });
    map[lead.id] = job.id;
  }

  return { batchId: batch.id, map };
}

async function regenerate(orgId: string, req: SubmitRequest): Promise<SubmitResponse> {
  if (!isNonEmpty(req.lead_id)) {
    throw new Error("regenerate requires lead_id");
  }
  const lead = await getLead(orgId, req.lead_id);
  if (!lead) throw new LeadNotFoundError(req.lead_id);

  if (!(await isProfileComplete(orgId))) {
    const profile = await getProfile(orgId);
    throw new ProfileIncompleteError(missingRequiredFields(profile));
  }

  const job = await createJob({ org_id: orgId, lead_id: lead.id, batch_id: lead.batch_id });
  return { batchId: lead.batch_id, map: { [lead.id]: job.id } };
}

export async function jobStatus(orgId: string, jobId: string): Promise<JobStatusView | null> {
  const job = await getJob(orgId, jobId);
  if (!job) return null;
  return { status: job.status, url: job.site_url, failureReason: job.failure_reason };
}
