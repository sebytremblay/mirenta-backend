// Makes real Anthropic API and Exa calls (a few cents per run).
import { runResearch } from "../src/agents/research.ts";
import { employeeServiceVertical } from "../src/verticals/employee-service.ts";

const vertical = employeeServiceVertical;

const lead = {
  first_name: "Jordan",
  last_name: "Avery",
  role: "VP of IT",
  company: "Plexus Corp",
  website_url: "https://www.plexus.com",
};

const profile = {
  company_name: "Salesforce",
  product_name: "Agentforce for IT Service and HR Service",
  value_prop:
    "AI agents that deflect IT and HR support volume across the enterprise",
};

console.log(`Starting research for ${lead.company}...`);
console.log();

try {
  const { research: result, usage } = await runResearch({
    lead,
    profile,
    vertical,
    onStep: (s) => console.log(`  [${s.phase}] ${s.detail}`),
  });

  console.log();
  console.log("=== RESEARCH RESULT ===");
  console.log();
  console.log(`Vertical: ${result.vertical}`);
  console.log(`Account summary: ${result.account.summary.slice(0, 100)}...`);
  console.log(`Recent moves: ${result.account.recent_moves.length} items`);
  console.log(
    `Self-description: ${result.account.self_description_language.slice(0, 80)}...`,
  );
  console.log();
  console.log(`Executives: ${result.executives.length}`);
  for (const exec of result.executives) {
    console.log(`  - ${exec.name}, ${exec.title}`);
  }
  console.log();
  console.log(`Quotes: ${result.quotes.length}`);
  for (const quote of result.quotes) {
    console.log(
      `  - "${quote.text.slice(0, 60)}..." (${quote.speaker}, verified: ${quote.verified})`,
    );
  }
  console.log();
  console.log(`Domains: ${result.extension.domains.join(", ")}`);
  console.log(`Priorities: ${result.extension.priorities.length}`);
  for (const pri of result.extension.priorities) {
    console.log(`  - ${pri.domain}: ${pri.pov.slice(0, 60)}...`);
  }
  console.log();
  console.log("Value inputs:");
  for (const [key, val] of Object.entries(result.extension.value_inputs)) {
    console.log(`  ${key}: ${val}`);
  }
  console.log(`  Estimated: ${result.extension.estimated}`);
  console.log();
  console.log(
    `Token usage: ${usage.requests} requests, ${usage.input_tokens} in / ${usage.output_tokens} out, ` +
      `cache ${usage.cache_creation_tokens} write / ${usage.cache_read_tokens} read`,
  );
  console.log();

  const checks = [
    {
      name: "has at least one executive",
      pass: result.executives.length >= 1,
    },
    {
      name: "total_employees > 0",
      pass: (result.extension.value_inputs.total_employees ?? 0) > 0,
    },
    { name: "vertical matches the spec", pass: result.vertical === vertical.id },
    {
      name: "has account summary",
      pass: result.account.summary.length > 0,
    },
  ];

  console.log("=== CHECKS ===");
  let allPass = true;
  for (const check of checks) {
    console.log(`  ${check.pass ? "✓" : "✗"} ${check.name}`);
    if (!check.pass) allPass = false;
  }
  console.log();

  if (allPass) {
    console.log("SMOKE RESEARCH: PASS");
  } else {
    console.log("SMOKE RESEARCH: FAIL (assertion failed)");
    process.exitCode = 1;
  }
} catch (e) {
  console.error();
  console.error("SMOKE RESEARCH: FAIL");
  console.error(
    `  ${(e as Error).constructor.name}: ${(e as Error).message}`,
  );
  if ((e as Error).stack) {
    console.error((e as Error).stack);
  }
  process.exitCode = 1;
}
