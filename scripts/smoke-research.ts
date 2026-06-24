// Delivers the research agent prompt so a human can paste it into a Claude Code
// session and run the research by hand. This makes NO live API call.
//
// stdout carries ONLY the prompt, so it pipes clean:
//   npm run --silent smoke:research | pbcopy
// On macOS the prompt also copies to the clipboard automatically. Diagnostics
// and wiring checks print to stderr, so they never pollute the copied text.
import { spawnSync } from "node:child_process";
import { buildAgentSystemPrompt, buildKickoff } from "../src/agents/research.ts";
import { salesMarketingVertical } from "../src/verticals/sales-marketing.ts";

// The research output path the builder smoke reads. Keep the two scripts in sync.
const RESEARCH_OUT = "/tmp/mirenta-research.json";

const vertical = salesMarketingVertical;

const lead = {
  first_name: "Finn",
  last_name: "Mallery",
  role: "Co-founder and CEO",
  company: "Origami",
  website_url: "https://www.origami.com",
};

const profile = {
  company_name: "Mirenta",
  product_name: "Mirenta",
  value_prop:
    "Turns a lead list into one hyper-personalized one-pager per founder, in their own language",
};

const systemPrompt = buildAgentSystemPrompt();
const kickoff = buildKickoff({ lead, profile, vertical });

// The full pasteable prompt: the agent role followed by its first task.
const prompt = `${systemPrompt}\n\n${kickoff}`;

// Copy to the macOS clipboard when pbcopy exists, so the prompt is paste-ready.
function copyToClipboard(text: string): boolean {
  try {
    return spawnSync("pbcopy", { input: text }).status === 0;
  } catch {
    return false;
  }
}

const copied = copyToClipboard(prompt);

// stdout: the raw prompt only when piped, so `| pbcopy` carries exactly it.
if (!process.stdout.isTTY) {
  process.stdout.write(prompt);
}

// stderr: everything human-facing.
const log = (line = ""): void => {
  process.stderr.write(`${line}\n`);
};

log(`smoke:research — vertical ${vertical.id}`);
log(copied ? "Copied the research prompt to the clipboard." : "pbcopy unavailable; pipe stdout instead.");
log(`Paste it into a Claude Code session with the Exa search tools, run the five`);
log(`phases, then save the emitted research object to ${RESEARCH_OUT}.`);
log();

const checks = [
  {
    name: "prompt hunts respected voices, not an executive roster",
    pass: /respect|voice/i.test(prompt) && !/\bexecutive roster\b/i.test(prompt),
  },
  {
    name: "prompt names the self/backer/tribe ladder",
    pass: /self/.test(prompt) && /backer/.test(prompt) && /tribe/.test(prompt),
  },
  {
    name: "prompt carries the vertical voice targeting",
    pass: prompt.includes(vertical.voiceTargeting.slice(0, 24)),
  },
  {
    name: "prompt names the vertical id",
    pass: prompt.includes(vertical.id),
  },
];

let allPass = true;
for (const check of checks) {
  log(`  ${check.pass ? "PASS" : "FAIL"}  ${check.name}`);
  if (!check.pass) allPass = false;
}
log();
log(allPass ? "SMOKE RESEARCH: PASS" : "SMOKE RESEARCH: FAIL (a prompt check failed)");
if (!allPass) process.exitCode = 1;
