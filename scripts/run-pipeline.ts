// End-to-end pipeline runner: the goal proof. Seeds an org and product profile,
// submits one lead through the Lead Service, drives the worker tick loop until
// the job reaches done or failed, then fetches the published S3 URL and confirms
// it renders. Exercises the real pipeline against Claude Managed Agents (research),
// the Messages API (build), Exa, Supabase, and S3. Run: node scripts/run-pipeline.ts
//
// Target persona: a Salesforce account executive selling Agentforce for IT
// Service and HR Service into Plexus Corp (the design's reference vertical).

import { setTimeout as sleep } from "node:timers/promises";

import { db, createOrganization } from "../src/db/client.ts";
import { saveProfile } from "../src/services/personalization.ts";
import { submit, jobStatus } from "../src/services/leads.ts";
import { runTick, type TickLogger } from "../src/worker/tick.ts";

const tag = `e2e-${Date.now()}`;
let orgId: string | null = null;

const log: TickLogger = (msg, meta) => {
  const line = meta ? `${msg} ${JSON.stringify(meta)}` : msg;
  console.log(`  [worker] ${line}`);
};

try {
  console.log("=== 1. Seed org + product profile (onboarding) ===");
  const org = await createOrganization(`Salesforce AE ${tag}`, tag);
  orgId = org.id;
  await saveProfile(org.id, {
    company_name: "Salesforce",
    product_name: "Agentforce for IT Service and HR Service",
    value_prop:
      "AI agents that deflect IT and HR support volume across the enterprise and free service teams for higher-value work",
    positioning:
      "The employee service platform that unifies HR and IT support on one trusted AI foundation",
    cta_text: "Book a working session",
    brand: { primary_color: "#0176d3" },
    vertical: "salesforce_employee_service",
  });
  console.log("  org:", org.id);

  console.log("\n=== 2. Submit one lead (POST /leads equivalent) ===");
  const result = await submit(org.id, {
    source: "manual",
    leads: [
      {
        first_name: "Jordan",
        last_name: "Avery",
        role: "VP of IT",
        company: "Plexus Corp",
        website_url: "https://www.plexus.com",
        email: `jordan.avery+${tag}@plexus.com`,
      },
    ],
  });
  const [leadId, jobId] = Object.entries(result.map)[0]!;
  console.log("  batchId:", result.batchId);
  console.log("  leadId -> jobId:", leadId, "->", jobId);

  console.log("\n=== 3. Drive the worker until the job finishes ===");
  const startedAt = Date.now();
  const maxMs = 8 * 60 * 1000; // generous ceiling for two live agent stages
  let status = "pending";
  let url: string | null = null;
  while (Date.now() - startedAt < maxMs) {
    const tick = await runTick(log);
    const view = await jobStatus(org.id, jobId);
    status = view?.status ?? "unknown";
    url = view?.url ?? null;
    if (status === "done") break;
    if (status === "failed") {
      console.error("  job failed:", view?.failureReason);
      break;
    }
    // Wait out the rest of the lease window only if nothing advanced; otherwise
    // tick again promptly to move to the next stage.
    await sleep(tick.advanced > 0 ? 500 : 3000);
  }
  console.log("  final status:", status);
  console.log("  site_url:", url);

  if (status !== "done" || !url) {
    console.error("\nPIPELINE: FAIL (job did not reach done with a URL)");
    process.exitCode = 1;
  } else {
    console.log("\n=== 4. Fetch the published page ===");
    const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    const html = await res.text();
    const company = "Plexus";
    const checks = {
      http200: res.status === 200,
      isHtml: /^<!doctype html/i.test(html.trim()) || /^<html/i.test(html.trim()),
      hasCompany: html.includes(company),
      hasRoi: /\$\d/.test(html),
      selfContained: !/<link[^>]+stylesheet/i.test(html) && !/<script[^>]+src=/i.test(html),
    };
    console.log("  checks:", JSON.stringify(checks));
    console.log("  bytes:", html.length);
    const allPass = Object.values(checks).every(Boolean);
    console.log(allPass ? "\nPIPELINE: PASS" : "\nPIPELINE: FAIL (page checks)");
    if (allPass) {
      console.log("\n  Published, rendering one-pager:");
      console.log("  " + url);
    } else {
      process.exitCode = 1;
    }
  }
} catch (e) {
  console.error("\nPIPELINE: FAIL", (e as Error).message);
  console.error((e as Error).stack);
  process.exitCode = 1;
} finally {
  // Keep the org + S3 object so the URL stays viewable. Print the cleanup command
  // rather than deleting, so the operator can inspect the result first.
  if (orgId) {
    console.log(`\n(To clean up later: delete org ${orgId} and its S3 prefix.)`);
  }
}
