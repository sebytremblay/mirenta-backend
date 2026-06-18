// Research Agent: the front stage of the Mirenta pipeline. Takes one lead and
// produces the structured research object the Website Builder consumes. Runs a
// multi-phase search loop: account research + domain priorities, executive
// discovery, quote capture with verification, and ROI volume inputs.
//
// See mirenta-docs/technical/research-agent-design.md for the canonical design
// and mirenta-docs/research/personalized-site-creation-workflow.md for the
// deliverable definitions.

import { runAgentLoop } from "../providers/anthropic.ts";
import type { LoopTool } from "../providers/anthropic.ts";
import { exaSearch, exaFetchContents } from "../providers/exa.ts";
import type { ExaResult } from "../providers/exa.ts";
import {
  validateResearch,
  RESEARCH_TOOL_SCHEMA,
  MVP_VERTICAL,
  MVP_DOMAINS,
  EXECUTIVE_SLOTS,
} from "../domain/research.ts";
import type { ResearchObject } from "../domain/research.ts";
import { config } from "../config/env.ts";
import type { Lead, ProductProfile } from "../domain/entities.ts";

export interface ResearchInput {
  // Type off the persisted row shapes so the worker passes Lead/ProductProfile
  // rows straight through with one source of truth (entities.ts).
  lead: Pick<Lead, "first_name" | "last_name" | "role" | "company" | "website_url">;
  profile: Pick<ProductProfile, "company_name" | "product_name" | "value_prop">;
  onStep?: (step: { phase: string; detail: string }) => void;
}

// Build the system prompt that guides the agent through the four research phases.
// The prompt enforces the house writing style (no contractions, active voice,
// strong verbs), instructs the model to produce all five deliverables, and
// explains the quote verification rigor (D37).
function buildSystemPrompt(input: ResearchInput): string {
  const leadName = `${input.lead.first_name} ${input.lead.last_name}`;
  const leadRole = input.lead.role ? ` (${input.lead.role})` : "";
  const company = input.lead.company;
  // The website is only ever shown to the model as context, never fetched, so a
  // plain note reads more honestly than a fabricated search URL.
  const website = input.lead.website_url || "(no website provided; search for it)";

  return `You are a B2B research agent producing hyper-personalized intelligence for an outbound sales campaign.

# Your Mission

Research ${company} and produce a structured research object for a one-pager website targeting ${leadName}${leadRole}.

The seller is ${input.profile.company_name}, and the product is ${input.profile.product_name}: ${input.profile.value_prop}.

The target vertical is ${MVP_VERTICAL}, focusing on ${MVP_DOMAINS.join(" and ")} domains.

# Four Research Phases

Execute these phases in order. Use the search_web tool to gather facts, then call emit_research exactly once with your final structured result.

## Phase 1: Account Research + Domain Priorities

Research ${company} (${website}):
- What the company does, its industry, scale, and recent strategic moves (acquisitions, expansions, leadership changes).
- Extract the language the company uses to describe itself (mission statements, taglines, about-us copy).
- Surface the top priorities in ${MVP_DOMAINS[0]} and ${MVP_DOMAINS[1]} through an executive lens: what matters to the VP of HR, CHRO, CIO, or VP of IT, and why now.
- Frame each domain priority as a point of view (POV): a stance on what the buyer recognizes as their own priorities.

## Phase 2: Executive Discovery

Find up to ${EXECUTIVE_SLOTS} key executives at ${company}. Prioritize:
- ${MVP_DOMAINS[0]} leadership (CHRO, VP of HR)
- ${MVP_DOMAINS[1]} leadership (CIO, VP of IT)
- C-suite (CEO, President, COO)

For each executive, gather:
- Full name and title
- What they own (area of responsibility)
- A synthesized profile: their goals, public statements, and how they think (from interviews, LinkedIn posts, press releases)

If the company has more than ${EXECUTIVE_SLOTS} relevant leaders, rank by seniority and relevance to ${MVP_DOMAINS.join("/")} and keep the top ${EXECUTIVE_SLOTS}. If fewer than ${EXECUTIVE_SLOTS}, fill what you find and leave the rest empty.

## Phase 3: Verifiable Quotes

Extract public quotes from executives or spokespeople at ${company}. Each quote must:
- Be a direct statement from interviews, press releases, LinkedIn posts, or blog posts.
- Carry a source_url pointing to the original publication.
- Be verifiable: after extracting a quote, use search_web to re-fetch the source page and confirm the wording matches. Mark verified: true only if confirmed.

Strict quote rigor (D37): any quote that fails re-fetch verification drops. Do not invent or paraphrase quotes.

## Phase 4: ROI Volume Inputs

Gather headcount data for ${company}:
- total_employees: the company's total global headcount (from LinkedIn, press releases, About pages, or industry databases).
- it_staff: the number of IT Service Desk reps, help desk staff, or IT support managers. This is usually not public; if unavailable, estimate based on industry benchmarks (roughly 0.5% to 1% of total employees for mid-to-large enterprises) and set estimated: true.
- hr_staff: the number of HR Service Desk reps, HR shared services staff, or employee relations staff. Also usually not public; estimate if needed (roughly 0.1% to 0.3% of total employees) and set estimated: true.

If you find actual it_staff or hr_staff counts in job postings, org charts, or press releases, use those and set estimated: false. Otherwise, estimate and flag it.

# Writing Style

All prose fields (summary, profiles, POV, why_now) must follow the house style:
- No contractions (use "do not" not "don't")
- Active voice, present tense
- Strong verbs (avoid "leverage", "unlock", "transformative", "seamless", "delve", "robust")
- No weak openers ("In today's...", "It is important to note that...")
- No em dashes

# Tools

- search_web: query the web for facts. Use this for every phase. You can call it many times.
- emit_research: call exactly once at the end with your final structured result. This tool is forced on the last turn.

# Output Shape

The emit_research tool expects:
{
  vertical: "${MVP_VERTICAL}",
  account: { summary, recent_moves[], self_description_language },
  executives: [{ name, title, owns, profile }],  // up to ${EXECUTIVE_SLOTS}
  quotes: [{ text, speaker, source_url, verified }],
  extension: {
    domains: ${JSON.stringify(MVP_DOMAINS)},
    priorities: [{ domain, pov, why_now }],  // one per domain
    roi_inputs: { total_employees, it_staff, hr_staff, estimated }
  }
}

Be thorough. Use search_web liberally. Verify every quote. Produce a complete, high-quality research object that the downstream builder can trust.`;
}

// The search_web tool: the agent's only working tool. Wraps exaSearch and
// optionally exaFetchContents for quote verification.
function createSearchTool(input: ResearchInput): LoopTool {
  return {
    name: "search_web",
    description:
      "Search the web for facts about a company, executives, quotes, or headcount data. Returns page titles, URLs, and text snippets. You can call this many times.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "The search query" },
        numResults: {
          type: "number",
          description: "Number of results to return (default 5, max 10)",
        },
        verifyUrl: {
          type: "string",
          description:
            "Optional: a specific URL to re-fetch for quote verification. If provided, fetches this URL instead of searching.",
        },
      },
      required: ["query"],
    },
    run: async (toolInput) => {
      const query = String(toolInput.query || "");
      const numResults = Math.min(
        10,
        Math.max(1, Number(toolInput.numResults) || 5),
      );
      const verifyUrl = toolInput.verifyUrl ? String(toolInput.verifyUrl) : null;

      if (verifyUrl) {
        // Quote verification mode (D37): re-fetch the source and return its text
        // so the model can confirm the wording. A failed or empty re-fetch is a
        // verification failure, not benign prose: signal it clearly so the model
        // drops the quote rather than reading silence as confirmation. Let a
        // thrown fetch error propagate to the loop, which marks it is_error.
        input.onStep?.({ phase: "quotes", detail: `verifying ${verifyUrl}` });
        const fetched = await exaFetchContents([verifyUrl], { maxCharacters: 4000 });
        const text = fetched[0]?.text?.trim();
        if (!text) {
          return `VERIFICATION_FAILED: could not retrieve source content from ${verifyUrl}. Drop any quote that depends on this source (set verified: false or omit it).`;
        }
        return `Source content for verification (${verifyUrl}):\n${text}`;
      }

      // Normal search mode. A thrown Exa error propagates to the loop, which
      // marks the tool_result is_error so the model can react rather than read a
      // failure as a benign empty result.
      const results = await exaSearch(query, { numResults, maxCharacters: 2000 });
      if (results.length === 0) {
        return `No results found for query: ${query}`;
      }
      return results
        .map((r) => {
          const parts = [`# ${r.title}`, `URL: ${r.url}`];
          if (r.text) parts.push(r.text);
          if (r.author) parts.push(`Author: ${r.author}`);
          if (r.publishedDate) parts.push(`Published: ${r.publishedDate}`);
          return parts.join("\n");
        })
        .join("\n\n---\n\n");
    },
  };
}

// The main export: run the research loop and return the validated ResearchObject.
export async function runResearch(
  input: ResearchInput,
): Promise<ResearchObject> {
  input.onStep?.({ phase: "start", detail: `researching ${input.lead.company}` });

  const systemPrompt = buildSystemPrompt(input);
  const searchTool = createSearchTool(input);

  const rawResult = await runAgentLoop({
    model: config.anthropic.researchModel,
    system: systemPrompt,
    prompt: `Begin research for ${input.lead.company}. Start with Phase 1: Account Research and Domain Priorities.`,
    tools: [searchTool],
    finalTool: {
      name: "emit_research",
      description:
        "Emit the final structured research object. Call this exactly once when you have completed all four phases.",
      input_schema: RESEARCH_TOOL_SCHEMA,
    },
    maxTurns: config.agents.researchMaxTurns,
    maxTokens: config.agents.researchMaxTokens,
    onStep: (s) => {
      // Forward the loop's own step kind as the phase. The model does not run
      // phases on a fixed turn cadence, so inferring a phase from the turn number
      // mislabels the work; the step kind (tool_use, text, final) is honest.
      input.onStep?.({ phase: s.kind, detail: s.detail.slice(0, 120) });
    },
  });

  input.onStep?.({ phase: "validate", detail: "validating research object" });
  const validated = validateResearch(rawResult);
  input.onStep?.({ phase: "done", detail: "research complete" });

  return validated;
}
