// The worker tick. Claims due jobs and advances each by a single stage
// transition (mvp-pipeline-architecture Job Lifecycle / Durability Layer).
//
// Managed Agents is unreachable, so each agent stage runs the loop in-process to
// completion within the lease (D45): the start/poll/collect split collapses into
// one synchronous stage call. The durability layer is unchanged — guarded
// transitions, a lease, the attempt ceiling, and transient/permanent error
// classification still bound the loop.
//
// Stage mapping under the in-process loop:
//   pending  -> run research, persist it            -> building
//   building -> build the page, upload to S3        -> done
// The documented `researching` and `publishing` states were resting points for
// the async session poll, which no longer exists; the build-and-publish step is
// one durable transition because the deterministic S3 key makes the upload
// idempotent, so no rendered HTML needs to survive between ticks.

import { config } from "../config/env.ts";
import {
  claimJobs,
  getLead,
  getResearchForJob,
  insertResearch,
  updateJob,
} from "../db/client.ts";
import { getProfile } from "../services/personalization.ts";
import { runResearch } from "../agents/research.ts";
import { buildSite } from "../agents/builder.ts";
import { publishSite } from "../providers/storage.ts";
import { AgentRefusalError } from "../providers/anthropic.ts";
import { validateResearch, ResearchSchemaError, type ResearchObject } from "../domain/research.ts";
import type { Job, JobStatus } from "../domain/entities.ts";

// A permanent failure moves the job straight to failed; a transient one leaves
// the job in place so a later tick retries after the lease expires.
class PermanentStageError extends Error {}

export interface TickResult {
  claimed: number;
  advanced: number;
  failed: number;
  details: Array<{ jobId: string; from: string; to: string; note?: string }>;
}

export type TickLogger = (msg: string, meta?: Record<string, unknown>) => void;

const noopLog: TickLogger = () => {};

// Run one tick: claim a batch and advance each claimed job by one transition.
export async function runTick(log: TickLogger = noopLog): Promise<TickResult> {
  const claimed = await claimJobs(config.worker.claimBatchSize, config.worker.leaseSeconds);
  const result: TickResult = { claimed: claimed.length, advanced: 0, failed: 0, details: [] };

  for (const job of claimed) {
    try {
      const to = await advance(job, log);
      if (to) {
        result.advanced += 1;
        result.details.push({ jobId: job.id, from: job.status, to });
      }
    } catch (err) {
      const permanent = err instanceof PermanentStageError || err instanceof AgentRefusalError;
      const reason = (err as Error).message;
      if (permanent || job.attempts >= config.worker.maxJobAttempts) {
        await failJob(job, reason);
        result.failed += 1;
        result.details.push({
          jobId: job.id,
          from: job.status,
          to: "failed",
          note: `${permanent ? "permanent" : "attempts exhausted"}: ${reason}`,
        });
        log("job failed", { jobId: job.id, reason, permanent });
      } else {
        // Transient: leave the job in place. The lease expires and a later tick
        // retries the same stage. The attempt counter (bumped by the claim)
        // bounds these retries.
        log("job transient error, will retry", {
          jobId: job.id,
          reason,
          attempts: job.attempts,
        });
        result.details.push({
          jobId: job.id,
          from: job.status,
          to: job.status,
          note: `transient: ${reason}`,
        });
      }
    }
  }
  return result;
}

// Advance one job by exactly one stage. Returns the new status, or null if the
// guarded transition lost a race (another tick already advanced it).
async function advance(job: Job, log: TickLogger): Promise<string | null> {
  switch (job.status) {
    case "pending":
    case "researching":
      // `researching` is reached only when a prior tick crashed after the claim
      // but before persisting research; re-run the stage from that status.
      return researchStage(job, log);
    case "building":
    case "publishing":
      // `publishing` likewise only appears on crash recovery; the build-and-
      // publish step re-runs idempotently.
      return buildAndPublishStage(job, log);
    default:
      return null; // done | failed: nothing to do.
  }
}

// Research stage: run the in-process research loop, persist the object, advance
// to building. Idempotent: re-running inserts a fresh research row and the
// guarded transition only fires from the claimed status.
async function researchStage(job: Job, log: TickLogger): Promise<string | null> {
  const lead = await getLead(job.org_id, job.lead_id);
  if (!lead) throw new PermanentStageError("lead disappeared");
  const profile = await getProfile(job.org_id);
  if (!profile) throw new PermanentStageError("product profile disappeared");

  log("research start", { jobId: job.id, company: lead.company });
  let research: ResearchObject;
  try {
    research = await runResearch({
      lead: {
        first_name: lead.first_name,
        last_name: lead.last_name,
        role: lead.role,
        company: lead.company,
        website_url: lead.website_url,
      },
      profile: {
        company_name: profile.company_name,
        product_name: profile.product_name,
        value_prop: profile.value_prop,
      },
      onStep: (s) => log("research step", { jobId: job.id, phase: s.phase, detail: s.detail }),
    });
  } catch (err) {
    // A refusal or a schema-invalid result is permanent: a retry repeats it.
    // Everything else (timeout, rate limit, network) is transient and retried
    // via the lease. runResearch validates before returning, so a schema error
    // surfaces here as a typed ResearchSchemaError, classified on instanceof.
    if (err instanceof AgentRefusalError) throw err;
    if (err instanceof ResearchSchemaError) {
      throw new PermanentStageError(`research validation failed: ${err.message}`);
    }
    throw err; // transient
  }

  const row = await insertResearch({ job_id: job.id, org_id: job.org_id, payload: research });

  const updated = await updateJob(job.id, job.status, {
    status: "building",
    research_id: row.id,
  });
  if (!updated) return null; // lost the guard race
  log("research done", { jobId: job.id, researchId: row.id });
  return "building";
}

// Build-and-publish stage: read the persisted research and profile, build the
// self-contained page, upload it to the deterministic S3 key, store the URL, and
// mark the job done. The upload overwrites identical bytes on a repeat, so the
// whole stage is safe to re-run.
async function buildAndPublishStage(job: Job, log: TickLogger): Promise<string | null> {
  const lead = await getLead(job.org_id, job.lead_id);
  if (!lead) throw new PermanentStageError("lead disappeared");
  const profile = await getProfile(job.org_id);
  if (!profile) throw new PermanentStageError("product profile disappeared");

  const researchRow = await getResearchForJob(job.id);
  if (!researchRow) throw new PermanentStageError("research row missing for build");
  const research = validateResearch(researchRow.payload);

  log("build start", { jobId: job.id });
  let html: string;
  try {
    html = await buildSite({
      lead: {
        first_name: lead.first_name,
        last_name: lead.last_name,
        role: lead.role,
        company: lead.company,
        website_url: lead.website_url,
      },
      profile,
      research,
      onStep: (s) => log("build step", { jobId: job.id, phase: s.phase, detail: s.detail }),
    });
  } catch (err) {
    if (err instanceof AgentRefusalError) throw err; // permanent
    throw err; // transient
  }

  log("publish start", { jobId: job.id, bytes: html.length });
  const published = await publishSite(job.org_id, job.id, html);

  const updated = await updateJob(job.id, job.status, {
    status: "done",
    html_s3_key: published.key,
    site_url: published.url,
  });
  if (!updated) return null;
  log("publish done", { jobId: job.id, url: published.url });
  return "done";
}

async function failJob(job: Job, reason: string): Promise<void> {
  // Move to failed from the claimed status. If it lost a race, the job already
  // advanced and the guard skips the write.
  await updateJob(job.id, job.status as JobStatus, {
    status: "failed",
    failure_reason: reason.slice(0, 1000),
  });
}
