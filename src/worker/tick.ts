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
import { getVertical } from "../verticals/index.ts";
import { runResearch } from "../agents/research.ts";
import { buildSite } from "../agents/builder.ts";
import { publishSite } from "../providers/storage.ts";
import { AgentRefusalError } from "../providers/anthropic.ts";
import { PageValidationError } from "../domain/page-validation.ts";
import { ValueModelContractError } from "../verticals/contract.ts";
import { validateResearch, ResearchSchemaError, type ResearchObject } from "../domain/research.ts";
import type { Job, JobStatus, TokenUsageAgent } from "../domain/entities.ts";

class PermanentStageError extends Error {}

export interface TickResult {
  claimed: number;
  advanced: number;
  failed: number;
  details: Array<{ jobId: string; from: string; to: string; note?: string }>;
}

export type TickLogger = (msg: string, meta?: Record<string, unknown>) => void;

const noopLog: TickLogger = () => {};

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

async function advance(job: Job, log: TickLogger): Promise<string | null> {
  switch (job.status) {
    case "pending":
    case "researching":
      return researchStage(job, log);
    case "building":
    case "publishing":
      return buildAndPublishStage(job, log);
    default:
      return null;
  }
}

// Telemetry is best-effort: a usage-write failure logs and returns rather than
// throwing, so it never fails a job whose real work already succeeded.
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

async function researchStage(job: Job, log: TickLogger): Promise<string | null> {
  const lead = await getLead(job.org_id, job.lead_id);
  if (!lead) throw new PermanentStageError("lead disappeared");
  const profile = await getProfile(job.org_id);
  if (!profile) throw new PermanentStageError("product profile disappeared");
  let vertical;
  try {
    vertical = getVertical(profile.vertical);
  } catch (err) {
    throw new PermanentStageError((err as Error).message);
  }

  log("research start", { jobId: job.id, company: lead.company });
  let research: ResearchObject;
  let usage: TokenUsageTotals;
  // The session id arrives on the "session" step before any work runs, so hold
  // it here even if the run later throws.
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
    if (err instanceof AgentRefusalError) throw err;
    if (err instanceof ResearchSchemaError) {
      throw new PermanentStageError(`research validation failed: ${err.message}`);
    }
    throw err;
  }

  // The session spent these tokens whether or not the transition below wins its
  // race, so record before the guarded update.
  await recordUsage(job, "research", config.anthropic.researchModel, usage, log);

  const row = await insertResearch({ job_id: job.id, org_id: job.org_id, payload: research });

  // Clear the lease on a clean advance so the next stage claims this job on the
  // very next tick rather than waiting out the full lease window.
  const updated = await updateJob(job.id, job.status, {
    status: "building",
    research_id: row.id,
    research_session_id: researchSessionId,
    lease_until: null,
  });
  if (!updated) return null;
  log("research done", { jobId: job.id, researchId: row.id, researchSessionId });
  return "building";
}

async function buildAndPublishStage(job: Job, log: TickLogger): Promise<string | null> {
  const lead = await getLead(job.org_id, job.lead_id);
  if (!lead) throw new PermanentStageError("lead disappeared");
  const profile = await getProfile(job.org_id);
  if (!profile) throw new PermanentStageError("product profile disappeared");
  let vertical;
  try {
    vertical = getVertical(profile.vertical);
  } catch (err) {
    throw new PermanentStageError((err as Error).message);
  }

  const researchRow = await getResearchForJob(job.id);
  if (!researchRow) throw new PermanentStageError("research row missing for build");
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
    if (err instanceof AgentRefusalError) throw err;
    if (err instanceof ValueModelContractError) {
      throw new PermanentStageError(`value model contract violation: ${err.message}`);
    }
    // A truncated page (PageValidationError.transient) retries on the lease; any
    // other page-validation failure is a permanent contract violation.
    if (err instanceof PageValidationError && !err.transient) {
      throw new PermanentStageError(`page validation failed: ${err.message}`);
    }
    throw err;
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
  await updateJob(job.id, job.status as JobStatus, {
    status: "failed",
    failure_reason: reason.slice(0, 1000),
  });
}
