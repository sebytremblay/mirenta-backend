// Research Agent: the front stage of the Mirenta pipeline. Takes one lead and
// produces the structured research object the Website Builder consumes. Runs a
// multi-phase search loop: account research + domain priorities, executive
// discovery, quote capture with verification, ROI volume inputs, and prospect
// brand capture (D48).
//
// Anthropic holds the loop (D50). The agent runs as a Claude Managed Agents
// session: the persistent agent definition carries the phase methodology, the
// house writing style, and the Exa MCP + emit_research tools (provisioned once
// by scripts/provision-managed-agents.ts). This module supplies the lead-specific
// kickoff message and harvests the structured emit_research result.
//
// The static system prompt stays byte-stable across leads so Anthropic caches it;
// only the kickoff message varies per lead. See
// mirenta-docs/technical/research-agent-design.md.

import { runManagedSession } from "../providers/managed-agents.ts";
import type { TokenUsageTotals } from "../providers/usage.ts";
import { validateResearch, EXECUTIVE_SLOTS } from "../domain/research.ts";
import type { ResearchObject } from "../domain/research.ts";
import type { VerticalSpec } from "../verticals/index.ts";
import { config } from "../config/env.ts";
import type { Lead, ProductProfile } from "../domain/entities.ts";

// The name of the custom tool the agent calls to emit its final result.
export const EMIT_RESEARCH_TOOL = "emit_research";

export interface ResearchInput {
  // Type off the persisted row shapes so the worker passes Lead/ProductProfile
  // rows straight through with one source of truth (entities.ts).
  lead: Pick<Lead, "first_name" | "last_name" | "role" | "company" | "website_url">;
  profile: Pick<ProductProfile, "company_name" | "product_name" | "value_prop">;
  // The active vertical (resolved from profile.vertical). Its domains, executive
  // targets, and value-input guidance ride in the per-lead kickoff, since the
  // persistent agent's system prompt is frozen and vertical-neutral.
  vertical: VerticalSpec;
  onStep?: (step: { phase: string; detail: string }) => void;
}

// The static system prompt the persistent research agent carries. It holds the
// five-phase methodology, the house writing style, and the deliverable spec, and
// it stays byte-stable across every lead and every vertical so Anthropic caches
// the prefix. It carries NO vertical specifics: the target vertical, domains,
// executive targets, and value inputs ride in the per-lead kickoff built by
// buildKickoff below, since one persistent agent serves all verticals.
export function buildAgentSystemPrompt(): string {
  return `You are a B2B research agent producing hyper-personalized intelligence for outbound sales campaigns.

# Your Mission

For each lead, research the prospect's company and produce a structured research object for a one-pager website. Your task message names the target vertical, the domains to organize priorities around, the executive roles to prioritize, and the value inputs to gather. Follow that brief.

# Five Research Phases

Execute these phases in order. Use the Exa web search tools to gather facts, then call ${EMIT_RESEARCH_TOOL} exactly once with your final structured result.

## Phase 1: Account Research + Domain Priorities

- What the company does, its industry, scale, and recent strategic moves (acquisitions, expansions, leadership changes).
- Extract the language the company uses to describe itself (mission statements, taglines, about-us copy).
- Surface the top priorities in each target domain (named in your task) through an executive lens: what matters to the relevant leaders, and why now. Set extension.domains to exactly the domains your task names.
- Frame each domain priority as a point of view (POV): a stance on what the buyer recognizes as their own priorities.

## Phase 2: Executive Discovery

Find up to ${EXECUTIVE_SLOTS} key executives at the company, prioritizing the roles your task names. For each executive, gather full name, title, what they own, and a synthesized profile (goals, public statements, how they think). Rank by seniority and relevance, keep the top ${EXECUTIVE_SLOTS}, and leave slots empty when the company has fewer relevant leaders.

## Phase 3: Verifiable Quotes

Extract public quotes from executives or spokespeople. Each quote must be a direct statement from interviews, press releases, LinkedIn posts, or blog posts, and must carry a source_url pointing to the original publication.

Strict quote rigor (D37): after extracting a quote, re-fetch the source page with the Exa fetch tool and confirm the wording matches. Set verified: true only when the re-fetch confirms it. Any quote that fails re-fetch verification drops. Do not invent or paraphrase quotes.

## Phase 4: Value Inputs

Gather the numeric value inputs your task names and place them in extension.value_inputs as a flat map of numbers. Use actual figures when you find them in job postings, filings, org charts, or releases, and set estimated: false. Otherwise estimate per your task's guidance and set estimated: true.

## Phase 5: Brand Capture

Read the prospect company's own website and capture its visual identity so the one-pager wears the prospect's brand, not a generic template. Populate the brand object:
- primary_color, accent_color, background_color, text_color: the company's brand colors as #RRGGBB hex, read from their site's headers, buttons, and headings.
- font_family: the primary typeface the site uses for headings or body.
- logo_url: an absolute https URL to the company's logo image.
- favicon_url: an absolute https URL to the company's favicon.

Source every value from the prospect's real site. Omit any field you cannot confirm rather than guessing; a missing field falls back cleanly downstream. Provide absolute https URLs only, since the page serves over https.

# Writing Style

All prose fields (summary, profiles, POV, why_now) follow the house style:
- No contractions (use "do not" not "don't")
- Active voice, present tense
- Strong verbs (avoid "leverage", "unlock", "transformative", "seamless", "delve", "robust")
- No weak openers ("In today's...", "It is important to note that...")
- No em dashes

# Output

Call ${EMIT_RESEARCH_TOOL} exactly once when all five phases finish. Set \`vertical\` and \`extension.domains\` to the values your task specifies. Produce a complete, high-quality object the downstream builder can trust, including the prospect brand tokens from Phase 5. Be thorough, search liberally, and verify every quote.`;
}

// Build the lead-specific kickoff message. This varies per lead and per vertical,
// so it carries the vertical brief (domains, executive targets, value inputs)
// that the frozen, vertical-neutral system prompt cannot.
function buildKickoff(input: ResearchInput): string {
  const leadName = `${input.lead.first_name} ${input.lead.last_name}`;
  const leadRole = input.lead.role ? ` (${input.lead.role})` : "";
  const company = input.lead.company;
  const website = input.lead.website_url || "(no website provided; search for it)";
  const { vertical } = input;

  return `Research ${company} and produce the research object for a one-pager targeting ${leadName}${leadRole}.

Company website: ${website}
Seller: ${input.profile.company_name}
Product: ${input.profile.product_name} — ${input.profile.value_prop}

# Vertical: ${vertical.id}

Target domains: ${vertical.domains.join(", ")}. Set extension.domains to exactly these.

Domain priorities (Phase 1):
${vertical.domainGuidance}

Executive targets (Phase 2):
${vertical.executiveTargeting}

Value inputs (Phase 4):
${vertical.inputGuidance}

Begin with Phase 1: Account Research and Domain Priorities. Work through all five phases, then call ${EMIT_RESEARCH_TOOL} exactly once with the complete structured result, with vertical set to "${vertical.id}".`;
}

// The validated research object plus the token usage the session spent, which
// the worker persists per agent stage (D33 precursor infra).
export interface ResearchResult {
  research: ResearchObject;
  usage: TokenUsageTotals;
}

// The main export: run the managed research session and return the validated
// ResearchObject plus its token usage. The worker classifies a thrown
// ResearchSchemaError or AgentRefusalError as permanent; everything else is
// transient and retried.
export async function runResearch(input: ResearchInput): Promise<ResearchResult> {
  input.onStep?.({ phase: "start", detail: `researching ${input.lead.company}` });

  const { result: raw, usage } = await runManagedSession({
    kickoff: buildKickoff(input),
    finalToolName: EMIT_RESEARCH_TOOL,
    // Leave headroom under the worker lease so a session that runs long still
    // aborts before a second tick re-claims the job.
    timeoutMs: Math.max(60_000, (config.worker.leaseSeconds - 60) * 1000),
    onStep: (s) => {
      // Forward the session's step kind as the phase. The agent does not run
      // phases on a fixed cadence, so the honest label is the event kind.
      input.onStep?.({ phase: s.kind, detail: s.detail.slice(0, 120) });
    },
  });

  input.onStep?.({ phase: "validate", detail: "validating research object" });
  const validated = validateResearch(raw, input.vertical);
  input.onStep?.({ phase: "done", detail: "research complete" });

  return { research: validated, usage };
}
