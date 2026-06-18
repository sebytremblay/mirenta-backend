// Live smoke test for the Website Builder: builds a complete HTML page from a
// hardcoded ResearchObject and ProductProfile, writes it to /tmp/mirenta-smoke.html,
// and validates the output. Proves the builder assembles valid HTML and calls the
// Anthropic API through the Salesforce gateway. Run: node scripts/smoke-builder.ts

import { buildSite } from "../src/agents/builder.ts";
import type { ResearchObject } from "../src/domain/research.ts";
import type { ProductProfile } from "../src/domain/entities.ts";
import { writeFileSync } from "node:fs";

// Construct a realistic sample ResearchObject (Plexus Corp).
const sampleResearch: ResearchObject = {
  vertical: "salesforce_employee_service",
  account: {
    summary:
      "Plexus Corp is a global electronics manufacturing services provider with operations across North America, Europe, and Asia. The company serves aerospace, defense, healthcare, and industrial sectors with advanced manufacturing and supply chain solutions. Recent initiatives focus on operational efficiency and digital transformation.",
    recent_moves: [
      "Expanded automation capabilities in manufacturing facilities",
      "Invested in supply chain visibility tools",
      "Launched employee training programs for digital tools",
    ],
    self_description_language:
      "Plexus describes itself as a customer-focused provider of innovative engineering solutions and manufacturing services.",
  },
  executives: [
    {
      name: "Todd Kelsey",
      title: "President and CEO",
      owns: "Corporate strategy and operational excellence",
      profile:
        "Todd Kelsey drives strategic growth and operational improvements across Plexus. He has emphasized digital transformation and workforce enablement as key priorities.",
    },
    {
      name: "Patrick Jermain",
      title: "CFO and Chief Administrative Officer",
      owns: "Financial operations and administrative functions",
      profile:
        "Patrick Jermain oversees finance and administrative processes. He focuses on cost efficiency and leveraging technology to streamline operations.",
    },
    {
      name: "Angelo Ninivaggi",
      title: "SVP and CIO",
      owns: "IT infrastructure and enterprise systems",
      profile:
        "Angelo Ninivaggi leads IT strategy and infrastructure modernization. He prioritizes system reliability, security, and employee productivity tools.",
    },
  ],
  quotes: [
    {
      text: "Our success depends on empowering our people with the right tools and information to serve our customers effectively.",
      speaker: "Todd Kelsey",
      source_url: "https://www.plexus.com/about-us/leadership",
      verified: true,
    },
    {
      text: "We are committed to operational excellence and continuous improvement across all functions.",
      speaker: "Patrick Jermain",
      source_url: "https://www.plexus.com/investor-relations",
      verified: true,
    },
  ],
  extension: {
    domains: ["HR", "ITSM"],
    priorities: [
      {
        domain: "HR",
        pov: "Plexus needs to scale HR service delivery without proportional headcount growth. AI-powered self-service can deflect repetitive inquiries and improve onboarding efficiency.",
        why_now:
          "The company is expanding globally and onboarding new employees rapidly. HR teams face increasing volumes of routine requests.",
      },
      {
        domain: "ITSM",
        pov: "Plexus requires faster IT support resolution to minimize downtime in manufacturing environments. Automating low-tier tickets frees skilled engineers for strategic projects.",
        why_now:
          "Operational uptime is critical. The IT service desk handles high ticket volumes, with many repetitive issues that can be automated.",
      },
    ],
    roi_inputs: {
      total_employees: 20000,
      it_staff: 80,
      hr_staff: 25,
      estimated: false,
    },
  },
};

// Construct a sample ProductProfile (Salesforce Agentforce).
const sampleProfile: ProductProfile = {
  org_id: "00000000-0000-0000-0000-000000000000",
  company_name: "Salesforce",
  product_name: "Agentforce for IT Service and HR Service",
  value_prop: "AI-powered employee support that deflects routine requests, accelerates resolution, and scales service delivery without adding headcount.",
  positioning:
    "Agentforce transforms employee service by combining AI agents with deep enterprise integrations, enabling self-service at scale.",
  proof_points: [
    { claim: "85% ticket deflection rate for low-priority IT issues", source: "customer case studies" },
    { claim: "50% reduction in onboarding coordination time", source: "Salesforce research" },
  ],
  cta_text: "Schedule a personalized demo",
  brand: { primary_color: "#0176d3" },
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

// Sample lead.
const sampleLead = {
  first_name: "Angelo",
  last_name: "Ninivaggi",
  role: "SVP and CIO",
  company: "Plexus Corp",
  website_url: "https://www.plexus.com",
};

// Run the builder.
try {
  console.log("Building site for Plexus Corp...");

  const html = await buildSite({
    lead: sampleLead,
    profile: sampleProfile,
    research: sampleResearch,
    onStep: (s) => console.log(`  [${s.phase}] ${s.detail}`),
  });

  // Write to /tmp/mirenta-smoke.html.
  const outputPath = "/tmp/mirenta-smoke.html";
  writeFileSync(outputPath, html, "utf8");

  // Validate the output.
  const startsCorrectly = html.startsWith("<!") || html.startsWith("<html");
  const containsCompany = html.includes("Plexus Corp");
  const containsDollarFigure = /\$\d/.test(html);

  console.log(`\nOutput written to ${outputPath} (${html.length} bytes)`);
  console.log(`Starts with HTML: ${startsCorrectly}`);
  console.log(`Contains company name: ${containsCompany}`);
  console.log(`Contains dollar figure: ${containsDollarFigure}`);

  const pass = startsCorrectly && containsCompany && containsDollarFigure;
  console.log(pass ? "\nSMOKE BUILDER: PASS" : "\nSMOKE BUILDER: FAIL");
  if (!pass) process.exitCode = 1;
} catch (e) {
  console.error("SMOKE BUILDER: FAIL", (e as Error).constructor.name, (e as Error).message);
  process.exitCode = 1;
}
