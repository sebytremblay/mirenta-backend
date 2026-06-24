// Cost-free smoke for the Research Agent prompt. Spends no tokens: no Managed
// Agents session, no Exa search. It assembles the EXACT prompt the research agent
// runs for the customer-zero lead (Finn Mallery, Co-Founder and CEO at Origami)
// and prints it to stdout, so `pnpm smoke:research | pbcopy` captures the prompt
// ready to paste into a fresh Claude Code session. The lead and seller mirror
// scripts/run-pipeline-mirenta.ts.
//
// The live agent finishes by calling the forced emit_research tool, which pins the
// output to RESEARCH_TOOL_SCHEMA. A pasted Claude Code session has no such tool, so
// without the schema it invents field names (full_name instead of name) and the
// builder smoke rejects the result. The prompt therefore appends the exact schema
// and a write-to-file target, so smoke:builder can consume the output verbatim.

import { rmSync } from "node:fs";
import { buildAgentSystemPrompt, buildKickoff } from "../src/agents/research.ts";
import { RESEARCH_TOOL_SCHEMA } from "../src/domain/research.ts";
import { founderLedSalesVertical } from "../src/verticals/founder-led-sales.ts";

const vertical = founderLedSalesVertical;
const RESEARCH_JSON_PATH =
  process.env.MIRENTA_RESEARCH_JSON ?? "/tmp/mirenta-research.json";

// Delete any prior research file so a stale object from an earlier run cannot
// silently feed smoke:builder. The pasted session writes a fresh one. Diagnostics
// go to stderr so stdout stays a clean prompt for `| pbcopy`.
rmSync(RESEARCH_JSON_PATH, { force: true });
process.stderr.write(`[smoke:research] cleared ${RESEARCH_JSON_PATH}\n`);

const lead = {
  first_name: "Finn",
  last_name: "Mallery",
  role: "Co-Founder and CEO",
  company: "Origami",
  website_url: "https://origami.chat/",
};

const profile = {
  company_name: "Mirenta",
  product_name: "Mirenta",
  value_prop:
    "Mirenta turns a lead list into one hyper-personalized one-pager website per prospect, so every outbound touch opens with research the prospect recognizes as their own priorities",
};

const systemPrompt = buildAgentSystemPrompt();
const kickoff = buildKickoff({ lead, profile, vertical });

// Replace the live emit_research tool call with a write to disk that smoke:builder
// reads. The object MUST match RESEARCH_TOOL_SCHEMA verbatim, the same shape the
// forced tool enforces in production.
const outputContract = `# Output (replaces the emit_research tool)

This session has no emit_research tool. When all five phases finish, write the
complete research object as JSON to ${RESEARCH_JSON_PATH}. Write nothing else to
that file. The object MUST match this exact JSON Schema (the live emit_research tool
enforces it; mismatched field names are rejected downstream):

${JSON.stringify(RESEARCH_TOOL_SCHEMA, null, 2)}`;

process.stdout.write(`${systemPrompt}\n\n${kickoff}\n\n${outputContract}\n`);
