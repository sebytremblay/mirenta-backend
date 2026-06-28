// Shared plumbing for the four-link smoke chain. Each link (strategist,
// research, designer, builder) builds a pasteable prompt for one LLM stage and
// chains to the next through a /tmp artifact. No link makes a live API call:
// a human or a subagent pastes the prompt into a Claude Code session, runs the
// stage by hand, and saves the structured output where the next link reads it.
// The real schemas, validators, and the recipe evaluator run between links, so a
// bad artifact fails loud in the harness rather than in production.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

// The chain's artifacts, in order. Each link reads the prior files and writes its
// own. The paths live here so every link agrees on them.
export const STRATEGY_FILE = "/tmp/mirenta-strategy.json";
export const RESEARCH_FILE = "/tmp/mirenta-research.json";
export const PAGE_SPEC_FILE = "/tmp/mirenta-page-spec.json";
export const PAGE_HTML_FILE = "/tmp/mirenta-page.html";

// stderr carries everything human-facing, so stdout stays a clean prompt for
// `| pbcopy`. Diagnostics, checks, and the verdict never pollute the copied text.
export function log(line = ""): void {
  process.stderr.write(`${line}\n`);
}

// Copy to the macOS clipboard when pbcopy exists, so the prompt is paste-ready.
export function copyToClipboard(text: string): boolean {
  try {
    return spawnSync("pbcopy", { input: text }).status === 0;
  } catch {
    return false;
  }
}

// Emit the assembled prompt: copy it to the clipboard, and write it to stdout
// when piped so `| pbcopy` carries exactly it. Returns whether the copy landed.
export function emitPrompt(prompt: string): boolean {
  const copied = copyToClipboard(prompt);
  if (!process.stdout.isTTY) process.stdout.write(prompt);
  return copied;
}

// Build the structured-output contract every link appends. A pasted Claude Code
// session has no emit_* tool, so the stage produces the tool argument as JSON
// matching the exact schema the tool enforces in production, and saves it where
// the next link reads it. The schema is the one source of truth, printed
// verbatim, so the smoke never drifts from the worker.
export function outputContract(
  toolName: string,
  schema: unknown,
  outFile: string,
  note = "",
): string {
  return `# Structured output

This session has no ${toolName} tool. Instead of calling it, produce its argument as JSON.

Write a single JSON object that conforms EXACTLY to this JSON Schema (the same schema the ${toolName} tool enforces in production). Emit the JSON inside one \`\`\`json block and nothing else, with no fields outside the schema:

\`\`\`json
${JSON.stringify(schema, null, 2)}
\`\`\`
${note ? `\n${note}\n` : ""}
Save the JSON object to ${outFile} so the next link reads it.`;
}

// Read and parse a prior link's artifact. Its absence fails loud with the command
// to run first, rather than substituting baked-in data: a silent fallback would
// let a later link pass without the earlier one ever running.
export function readArtifact(file: string, runFirst: string): unknown {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    throw new Error(`no artifact at ${file}. Run the prior link first: ${runFirst}`);
  }
  return JSON.parse(text) as unknown;
}

// Run a labelled list of boolean checks, print PASS/FAIL per check, and set the
// process exit code when any fails. Returns whether every check passed.
export function runChecks(label: string, checks: { name: string; pass: boolean }[]): boolean {
  let allPass = true;
  for (const check of checks) {
    log(`  ${check.pass ? "PASS" : "FAIL"}  ${check.name}`);
    if (!check.pass) allPass = false;
  }
  log();
  log(allPass ? `${label}: PASS` : `${label}: FAIL (a check failed)`);
  if (!allPass) process.exitCode = 1;
  return allPass;
}
