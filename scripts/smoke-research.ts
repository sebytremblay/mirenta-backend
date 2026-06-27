// Delivers the research agent prompt so a human can paste it into a Claude Code
// session and run the research by hand. This makes NO live API call.
//
// stdout carries ONLY the prompt, so it pipes clean:
//   npm run --silent smoke:research | pbcopy
// On macOS the prompt also copies to the clipboard automatically. Diagnostics
// and wiring checks print to stderr, so they never pollute the copied text.
import { spawnSync } from "node:child_process";
import { buildAgentSystemPrompt, buildKickoff, EMIT_RESEARCH_TOOL } from "../src/agents/research.ts";
import { RESEARCH_TOOL_SCHEMA } from "../src/domain/research.ts";
import { getVertical } from "../src/verticals/index.ts";
import { smokeLead, smokeProfile } from "./smoke-fixtures.ts";

// The research output path the builder smoke reads. Keep the two scripts in sync.
const RESEARCH_OUT = "/tmp/mirenta-research.json";

// Resolve the vertical from the profile, exactly as the worker's build stage
// does, so both phases run against the same vertical the seed declares.
const vertical = getVertical(smokeProfile.vertical);

// Both phases target the same prospect; the seed lives in smoke-fixtures.ts.
const lead = smokeLead;
const profile = smokeProfile;

const systemPrompt = buildAgentSystemPrompt();
const kickoff = buildKickoff({ lead, profile, vertical });

// In production the agent calls the emit_research tool, whose argument shape is
// RESEARCH_TOOL_SCHEMA. A pasted Claude Code session has no such tool, so spell
// the structured output out: emit JSON matching the exact schema validateResearch
// enforces, and save it where the builder smoke reads it. The schema is the one
// source of truth, printed verbatim, so the smoke never drifts from the worker.
const outputContract = `# Structured output

This session has no ${EMIT_RESEARCH_TOOL} tool. Instead of calling it, produce its argument as JSON.

Write a single JSON object that conforms EXACTLY to this JSON Schema (the same schema the ${EMIT_RESEARCH_TOOL} tool enforces in production). Emit no prose, no markdown fences around the final answer beyond one \`\`\`json block, and no fields outside the schema:

\`\`\`json
${JSON.stringify(RESEARCH_TOOL_SCHEMA, null, 2)}
\`\`\`

Set "vertical" to "${vertical.id}". Save the JSON object to ${RESEARCH_OUT} so the builder step can read it.`;

// The full pasteable prompt: the agent role, its first task, and the output shape.
const prompt = `${systemPrompt}\n\n${kickoff}\n\n${outputContract}`;

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
  {
    name: "prompt carries the structured-output schema with every required key",
    pass: RESEARCH_TOOL_SCHEMA.required.every((k) => prompt.includes(`"${k}"`)),
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
