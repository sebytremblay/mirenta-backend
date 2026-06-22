// End-to-end pipeline runner for the Mirenta self-sell demo. Seeds an org whose
// product profile IS Mirenta, submits one lead (a Salesforce account executive),
// drives the worker tick loop until the job reaches done or failed, then fetches
// the published S3 URL and confirms it renders. Exercises the real pipeline
// against Claude Managed Agents (research), the Messages API (build), Exa,
// Supabase, and S3. Run: node scripts/run-pipeline-mirenta.ts
//
// Customer (seller): the Mirenta team, selling Mirenta itself.
// Lead: Masafumi Kawashima, Account Executive at Salesforce.
// The profile declares the sales_marketing vertical: Mirenta sells outbound
// personalization to revenue and demand-generation leaders, so the page
// researches Salesforce through a Sales and Marketing lens and the value model
// renders pipeline-uplift ROI, with no HR/ITSM framing.

import { setTimeout as sleep } from "node:timers/promises";

import { createOrganization } from "../src/db/client.ts";
import { saveProfile } from "../src/services/personalization.ts";
import { submit, jobStatus } from "../src/services/leads.ts";
import { runTick, type TickLogger } from "../src/worker/tick.ts";

const tag = `mirenta-${Date.now()}`;
let orgId: string | null = null;

const log: TickLogger = (msg, meta) => {
  const line = meta ? `${msg} ${JSON.stringify(meta)}` : msg;
  console.log(`  [worker] ${line}`);
};

try {
  console.log("=== 1. Seed org + product profile (Mirenta sells Mirenta) ===");
  const org = await createOrganization(`Mirenta ${tag}`, tag);
  orgId = org.id;
  await saveProfile(org.id, {
    company_name: "Mirenta",
    product_name: "Mirenta",
    value_prop:
      "Mirenta turns a lead list into one hyper-personalized one-pager website per prospect, so every outbound touch opens with research the prospect recognizes as their own priorities",
    positioning:
      "The outbound personalization platform that researches each prospect and builds a prospect-facing one-pager that pitches in the prospect's own language",
    proof_points: [
      { claim: "One researched, brand-matched one-pager per lead, generated end to end" },
      { claim: "Every quote on the page is re-fetched and verified before it ships" },
    ],
    cta_text: "Book a working session",
    brand: { primary_color: "#3b5bdb" },
    vertical: "sales_marketing",
    // Mirenta's own list price: $100 per seat per month ($1,200 per year), no
    // platform fee, no implementation fee for the self-serve motion. The per-seat
    // price scales the license with the rep count the page addresses, so a page
    // targeting one account executive prices for one seat and the ROI stays honest
    // against a single rep's incremental pipeline (D57, D59). These match the
    // sales-marketing default economics; the script sets them explicitly so the
    // demo declares its price rather than inheriting a fallback.
    economics: {
      annual_license: 0,
      implementation_fee: 0,
      price_per_seat_year: 1_200,
      scenarios: [
        { name: "Conservative", effectiveness: { meeting_uplift: 0.1 } },
        { name: "Expected", effectiveness: { meeting_uplift: 0.2 } },
        { name: "Aggressive", effectiveness: { meeting_uplift: 0.35 } },
      ],
    },
  });
  console.log("  org:", org.id);

  console.log("\n=== 2. Submit one lead (POST /leads equivalent) ===");
  const result = await submit(org.id, {
    source: "manual",
    leads: [
      {
        first_name: "Masafumi",
        last_name: "Kawashima",
        role: "Account Executive",
        company: "Salesforce",
        website_url: "https://www.salesforce.com",
        email: "mkawashima@salesforce.com",
      },
    ],
  });
  const [leadId, jobId] = Object.entries(result.map)[0]!;
  console.log("  batchId:", result.batchId);
  console.log("  leadId -> jobId:", leadId, "->", jobId);

  console.log("\n=== 3. Drive the worker until the job finishes ===");
  const startedAt = Date.now();
  const maxMs = 30 * 60 * 1000; // generous ceiling for two live Sonnet agent stages with research uncapped
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
    const company = "Salesforce";
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
  if (orgId) {
    console.log(`\n(To clean up later: delete org ${orgId} and its S3 prefix.)`);
  }
}
