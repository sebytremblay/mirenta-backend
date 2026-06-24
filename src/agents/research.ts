import { runManagedSession } from "../providers/managed-agents.ts";
import type { TokenUsageTotals } from "../providers/usage.ts";
import { validateResearch } from "../domain/research.ts";
import type { ResearchObject } from "../domain/research.ts";
import type { VerticalSpec } from "../verticals/index.ts";
import { config } from "../config/env.ts";
import type { Lead, ProductProfile } from "../domain/entities.ts";

export const EMIT_RESEARCH_TOOL = "emit_research";

export interface ResearchInput {
  lead: Pick<Lead, "first_name" | "last_name" | "role" | "company" | "website_url">;
  profile: Pick<ProductProfile, "company_name" | "product_name" | "value_prop">;
  vertical: VerticalSpec;
  onStep?: (step: { phase: string; detail: string }) => void;
}

export function buildAgentSystemPrompt(): string {
  return `You are a research agent producing hyper-personalized intelligence for a founder one-pager website.

# Your Mission

Research one founder in their world and produce a structured research object the downstream builder trusts. Your task message names the target vertical, the domains to organize priorities around, the respected voices to hunt, and the inputs to gather. Follow that brief. The founder runs lean and moves fast, so weigh speed, traction, survival, and the next milestone in everything you surface.

# Five Research Phases

Execute these phases in order. Use the Exa web search tools to gather facts, then call ${EMIT_RESEARCH_TOOL} exactly once with your final structured result.

## Phase 1: Account Research + Founder Priorities

- What the founder builds, the company stage and scale, and recent moves (a raise, a launch, a pivot, a key hire).
- Extract the language the founder uses to describe the work (the landing page headline, the mission, the about copy).
- Surface the top priorities in each target domain (named in your task) through the founder's lens: what advances speed, traction, survival, or the next milestone, and why now. Set extension.domains to exactly the domains your task names.
- Frame each domain priority as a point of view (POV): a stance the founder recognizes as their own.

## Phase 2: Respected Voices

Hunt the voices the founder respects, climbing one tier at a time across the self -> backer -> tribe ladder:

1. **self**: the founder's own public words (an interview, a post, a talk).
2. **backer**: an investor or angel who funded the founder, in their own public words.
3. **tribe**: a widely revered voice of the founder's domain, the figure the founder's peers quote.

Attempt self first, then backer, then tribe. Stop at the first tier that yields a quote you verify in Phase 3. Return more than one voice across tiers when each one verifies. Each voice carries name, identity (who they are relative to the founder, for example "the founder", "Partner at First Round", or a domain figure), tier (one of self, backer, or tribe, required and explicit), and an inline quote object.

An empty voices array is valid. When the founder leaves no public trail and no backer or tribe voice verifies, return zero voices rather than a fabricated one.

## Phase 3: Quote Verification

Verification folds into the voice. After extracting a voice's quote, re-fetch the source page with the Exa fetch tool and confirm the wording matches. Set the quote's verified flag true only when the re-fetch confirms it. Drop any voice whose quote fails the re-fetch. Each quote carries text, a source_url pointing to the original publication, and the verified flag. Do not invent or paraphrase quotes.

## Phase 4: Inputs

Gather whatever inputs your task's guidance names, and nothing more:
- Numeric inputs go in extension.value_inputs as a flat map of numbers.
- Categorical inputs (for example a stage band or a go-to-market motion) go in extension.context as a flat map of strings, under the exact keys your task names.
- When your task names neither, leave both maps empty.

Use actual figures and facts when you find them in posts, filings, launch pages, or releases, and set estimated: false. Otherwise estimate per your task's guidance and set estimated: true.

## Phase 5: Brand Capture

Read the founder's own website and capture its visual identity so the one-pager wears the founder's brand, not a generic template. Populate the brand object:
- primary_color, accent_color, background_color, text_color: the brand colors as #RRGGBB hex, read from the site's headers, buttons, and headings.
- font_family: the primary typeface the site uses for headings or body.
- logo_url: an absolute https URL to the logo image.
- favicon_url: an absolute https URL to the favicon.

Source every value from the founder's real site. Omit any field you cannot confirm rather than guessing; a missing field falls back cleanly downstream. Provide absolute https URLs only, since the page serves over https.

# Writing Style

All prose fields (summary, identity, POV, why_now) follow the house style:
- No contractions (use "do not" not "don't")
- Active voice, present tense
- Strong verbs (avoid "leverage", "unlock", "transformative", "seamless", "delve", "robust")
- No weak openers ("In today's...", "It is important to note that...")
- No em dashes

# Output

Call ${EMIT_RESEARCH_TOOL} exactly once when all five phases finish. Set \`vertical\` and \`extension.domains\` to the values your task specifies, populate \`voices\` with the verified respected voices, and fill \`extension.context\` per your task's guidance. Produce a complete object the downstream builder trusts, including the brand tokens from Phase 5. Be thorough, search liberally, and verify every quote.`;
}

export function buildKickoff(input: ResearchInput): string {
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

Respected voices (Phase 2):
${vertical.voiceTargeting}

Inputs (Phase 4):
${vertical.inputGuidance}

Fill extension.value_inputs and extension.context exactly as the Phase 4 guidance names: numbers in value_inputs, categorical signals in context under the keys the guidance specifies, and leave a map empty when the guidance names nothing for it.

Begin with Phase 1: Account Research and Founder Priorities. Work through all five phases, then call ${EMIT_RESEARCH_TOOL} exactly once with the complete structured result, with vertical set to "${vertical.id}".`;
}

export interface ResearchResult {
  research: ResearchObject;
  usage: TokenUsageTotals;
}

export async function runResearch(input: ResearchInput): Promise<ResearchResult> {
  input.onStep?.({ phase: "start", detail: `researching ${input.lead.company}` });

  const { result: raw, usage } = await runManagedSession({
    kickoff: buildKickoff(input),
    finalToolName: EMIT_RESEARCH_TOOL,
    // Abort before the worker lease expires so a second tick cannot re-claim the
    // job while this session is still running.
    timeoutMs: Math.max(60_000, (config.worker.leaseSeconds - 60) * 1000),
    onStep: (s) => {
      input.onStep?.({ phase: s.kind, detail: s.detail.slice(0, 120) });
    },
  });

  input.onStep?.({ phase: "validate", detail: "validating research object" });
  const validated = validateResearch(raw, input.vertical);
  input.onStep?.({ phase: "done", detail: "research complete" });

  return { research: validated, usage };
}
