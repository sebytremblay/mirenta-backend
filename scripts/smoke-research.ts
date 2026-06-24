// Prints the research agent prompts so a human can paste them into a Claude Code
// session and run the research by hand. This makes NO live API call: it builds
// the exact system prompt and kickoff the worker would send, then tells you
// where to save the emitted research object for the builder smoke to read.
import { buildAgentSystemPrompt, buildKickoff } from "../src/agents/research.ts";
import { salesMarketingVertical } from "../src/verticals/sales-marketing.ts";

// The research output path the builder smoke reads. Keep the two scripts in sync.
const RESEARCH_OUT = "/tmp/mirenta-research.json";

const vertical = salesMarketingVertical;

const lead = {
  first_name: "Dana",
  last_name: "Okafor",
  role: "Founder and CEO",
  company: "Cadence Labs",
  website_url: "https://www.cadencelabs.dev",
};

const profile = {
  company_name: "Mirenta",
  product_name: "Mirenta",
  value_prop:
    "Turns a lead list into one hyper-personalized one-pager per founder, in their own language",
};

const systemPrompt = buildAgentSystemPrompt();
const kickoff = buildKickoff({ lead, profile, vertical });

const rule = "=".repeat(72);

console.log(rule);
console.log(`SMOKE RESEARCH (no API call) — vertical: ${vertical.id}`);
console.log(rule);
console.log();
console.log("Paste the SYSTEM PROMPT and the KICKOFF into a Claude Code session");
console.log("with the Exa web search tools attached. Let the agent run the five");
console.log(`phases, then save the emitted research object to:\n  ${RESEARCH_OUT}`);
console.log("The builder smoke reads that file.");
console.log();
console.log(rule);
console.log("RESEARCH SYSTEM PROMPT");
console.log(rule);
console.log(systemPrompt);
console.log();
console.log(rule);
console.log("KICKOFF (first user message)");
console.log(rule);
console.log(kickoff);
console.log();

// Cheap structural checks on the prompts, so the smoke still catches a prompt
// that drifts back to the enterprise framing.
const checks = [
  {
    name: "system prompt hunts respected voices, not an executive roster",
    pass: /respect|voice/i.test(systemPrompt) && !/\bexecutive roster\b/i.test(systemPrompt),
  },
  {
    name: "system prompt names the self/backer/tribe ladder",
    pass: /self/.test(systemPrompt) && /backer/.test(systemPrompt) && /tribe/.test(systemPrompt),
  },
  {
    name: "kickoff carries the vertical voice targeting",
    pass: kickoff.includes(vertical.voiceTargeting.slice(0, 24)),
  },
  {
    name: "kickoff names the vertical id",
    pass: kickoff.includes(vertical.id),
  },
];

console.log(rule);
console.log("CHECKS");
console.log(rule);
let allPass = true;
for (const check of checks) {
  console.log(`  ${check.pass ? "PASS" : "FAIL"}  ${check.name}`);
  if (!check.pass) allPass = false;
}
console.log();
if (allPass) {
  console.log("SMOKE RESEARCH: PASS");
} else {
  console.log("SMOKE RESEARCH: FAIL (a prompt check failed)");
  process.exitCode = 1;
}
