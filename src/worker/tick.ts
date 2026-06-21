// The worker tick. Claims due jobs and advances each by a single stage
// transition (mvp-pipeline-architecture Job Lifecycle / Durability Layer).
//
// Research runs on Claude Managed Agents (D50): Anthropic holds the agent loop,
// and the worker drives one session synchronously within the lease (open, kick
// off, drain to the emit_research result, collect). The build stage runs a
// one-shot Messages API call. The durability layer is unchanged — guarded
// transitions, a lease, the attempt ceiling, and transient/permanent error
// classification still bound each stage.
//
// Stage mapping:
//   pending  -> run the research session, persist it -> building
//   building -> build the page, upload to S3         -> done
// The documented `researching` and `publishing` states are crash-recovery
// resting points; the build-and-publish step is one durable transition because
// the deterministic S3 key makes the upload idempotent, so no rendered HTML
// needs to survive between ticks. A full webhook-driven start/poll/collect split
// (so the tick does not hold the session open) is a documented fast-follow.

import { config } from "../config/env.ts";
import {
  claimJobs,
  getLead,
  getResearchForJob,
  insertResearch,
  insertTokenUsage,
  updateJob,
} from "../db/client.ts";
import { computeCost } from "../providers/pricing.ts";
import type { TokenUsageTotals } from "../providers/usage.ts";
import { getProfile } from "../services/personalization.ts";
import { getVertical, type VerticalSpec } from "../verticals/index.ts";
import { runResearch } from "../agents/research.ts";
import { buildSite } from "../agents/builder.ts";
import { publishSite } from "../providers/storage.ts";
// One refusal type covers both paths: the builder (Messages API) and research
// (Managed Agents) share it. A refusal is always a permanent failure.
import { AgentRefusalError } from "../providers/anthropic.ts";
import { PageValidationError } from "../domain/page-validation.ts";
import { ValueModelContractError } from "../verticals/contract.ts";
import { validateResearch, ResearchSchemaError, type ResearchObject } from "../domain/research.ts";
import type { Job, JobStatus, Lead, ProductProfile, TokenUsageAgent } from "../domain/entities.ts";

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

// Record one agent stage's token usage and computed cost (D33 precursor infra).
// Telemetry is best-effort: a usage-write failure logs and returns rather than
// throwing, so it never fails a job whose real work already succeeded. The spend
// is real whether or not the stage's guarded transition wins its race, so this
// records right after the agent returns, before the transition.
async function recordUsage(
  job: Job,
  agent: TokenUsageAgent,
  model: string,
  usage: TokenUsageTotals,
  log: TickLogger,
): Promise<void> {
  const costUsd = computeCost(model, usage);
  try {
    await insertTokenUsage({
      org_id: job.org_id,
      job_id: job.id,
      lead_id: job.lead_id,
      agent,
      model,
      input_tokens: usage.input_tokens,
      output_tokens: usage.output_tokens,
      cache_creation_tokens: usage.cache_creation_tokens,
      cache_read_tokens: usage.cache_read_tokens,
      request_count: usage.requests,
      cost_usd: costUsd,
    });
    log("token usage recorded", {
      jobId: job.id,
      agent,
      model,
      inputTokens: usage.input_tokens,
      outputTokens: usage.output_tokens,
      cacheCreationTokens: usage.cache_creation_tokens,
      cacheReadTokens: usage.cache_read_tokens,
      requests: usage.requests,
      costUsd,
    });
  } catch (err) {
    log("token usage record failed", { jobId: job.id, agent, reason: (err as Error).message });
  }
}

// The lead, profile, and active vertical every stage needs before it runs. A
// missing lead or profile and an unknown vertical id are all misconfigured-input
// faults, not transient ones, so they fail the stage permanently rather than
// retrying a deterministic failure on the lease.
async function resolveStageContext(
  job: Job,
): Promise<{ lead: Lead; profile: ProductProfile; vertical: VerticalSpec }> {
  const lead = await getLead(job.org_id, job.lead_id);
  if (!lead) throw new PermanentStageError("lead disappeared");
  const profile = await getProfile(job.org_id);
  if (!profile) throw new PermanentStageError("product profile disappeared");
  try {
    return { lead, profile, vertical: getVertical(profile.vertical) };
  } catch (err) {
    throw new PermanentStageError((err as Error).message);
  }
}

// Research stage: drive the Managed Agents research session, persist the object, advance
// to building. Idempotent: re-running inserts a fresh research row and the
// guarded transition only fires from the claimed status.
async function researchStage(job: Job, log: TickLogger): Promise<string | null> {
  const { lead, profile, vertical } = await resolveStageContext(job);

  log("research start", { jobId: job.id, company: lead.company });
  let research: ResearchObject;
  let usage: TokenUsageTotals;
  // Capture the Managed Agents session id the run emits at create time (D56).
  // It arrives on the "session" step before any work runs, so we hold it even
  // if the run later throws, and we persist it onto the job below so a debug
  // pass can fetch the agent's reasoning transcript after the fact.
  let researchSessionId: string | null = null;
  try {
    ({ research, usage } = await runResearch({
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
      vertical,
      onStep: (s) => {
        if (s.phase === "session") researchSessionId = s.detail;
        log("research step", { jobId: job.id, phase: s.phase, detail: s.detail });
      },
    }));
  } catch (err) {
    // A refusal or a schema-invalid result is permanent: a retry repeats it.
    // Everything else (session timeout, rate limit, network, a stalled session)
    // is transient and retried via the lease. runResearch validates before
    // returning, so a schema error surfaces here as a typed ResearchSchemaError.
    if (err instanceof AgentRefusalError) throw err;
    if (err instanceof ResearchSchemaError) {
      throw new PermanentStageError(`research validation failed: ${err.message}`);
    }
    throw err; // transient (includes AgentSessionError: timeout, stall, terminate)
  }

  // The research session spent these tokens whether or not the transition below
  // wins its race, so record the spend before the guarded update.
  await recordUsage(job, "research", config.anthropic.researchModel, usage, log);

  const row = await insertResearch({ job_id: job.id, org_id: job.org_id, payload: research });

  // Clear the lease on a clean advance so the next stage claims this job on the
  // very next tick, rather than waiting out the full lease window. The lease
  // exists for crash recovery: a worker that dies mid-stage leaves lease_until
  // set, and expiry re-claims the job. A successful transition has no such
  // worker to wait on, so decouple handoff latency from the lease length (which
  // also bounds the research timeout, and runs long now that research is uncapped).
  const updated = await updateJob(job.id, job.status, {
    status: "building",
    research_id: row.id,
    // Persist the retained session id (D56) so a debug pass can pull the agent's
    // reasoning transcript. Null when the run emitted no id (an older run shape).
    research_session_id: researchSessionId,
    lease_until: null,
  });
  if (!updated) return null; // lost the guard race
  log("research done", { jobId: job.id, researchId: row.id, researchSessionId });
  return "building";
}

// Build-and-publish stage: read the persisted research and profile, build the
// self-contained page, upload it to the deterministic S3 key, store the URL, and
// mark the job done. The upload overwrites identical bytes on a repeat, so the
// whole stage is safe to re-run.
async function buildAndPublishStage(job: Job, log: TickLogger): Promise<string | null> {
  const { lead, profile, vertical } = await resolveStageContext(job);

  const researchRow = await getResearchForJob(job.id);
  if (!researchRow) throw new PermanentStageError("research row missing for build");
  // Re-validate against the active vertical's value contract before building. A
  // schema-invalid persisted payload is permanent: a retry re-reads the same row.
  let research: ResearchObject;
  try {
    research = validateResearch(researchRow.payload, vertical);
  } catch (err) {
    if (err instanceof ResearchSchemaError) {
      throw new PermanentStageError(`research validation failed: ${err.message}`);
    }
    throw err;
  }

  log("build start", { jobId: job.id });
  let html: string;
  let usage: TokenUsageTotals;
  try {
    ({ html, usage } = await buildSite({
      lead: {
        first_name: lead.first_name,
        last_name: lead.last_name,
        role: lead.role,
        company: lead.company,
        website_url: lead.website_url,
      },
      profile,
      research,
      vertical,
      onStep: (s) => log("build step", { jobId: job.id, phase: s.phase, detail: s.detail }),
    }));
  } catch (err) {
    if (err instanceof AgentRefusalError) throw err; // permanent
    // A value-model contract breach (wrong scenario count or names, missing
    // footnote when estimated) is a misconfigured vertical, not a transient
    // fault: compute() re-reads the same persisted research and the same
    // economics every retry, so the breach reproduces identically. Fail
    // permanently rather than burn the attempt budget on futile builder runs.
    if (err instanceof ValueModelContractError) {
      throw new PermanentStageError(`value model contract violation: ${err.message}`);
    }
    // A page that fails validation after the builder's corrective retries is a
    // permanent contract violation: a retry re-reads the same research and
    // repeats it. A truncated page (PageValidationError.transient) falls through
    // to the transient path and retries on the lease like a network fault.
    if (err instanceof PageValidationError && !err.transient) {
      throw new PermanentStageError(`page validation failed: ${err.message}`);
    }
    throw err; // transient (includes truncation and network faults)
  }

  await recordUsage(job, "builder", config.anthropic.builderModel, usage, log);

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
