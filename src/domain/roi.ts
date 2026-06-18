// Business-value / ROI model (D38). Implements the reference methodology in
// mirenta-docs/research/personalized-site-creation-workflow.md Step 4: apply the
// fixed per-employee ticket and interaction formulas to total headcount, present
// the dollar figure across conservative / expected / aggressive scenarios.
//
// This is deterministic domain logic, kept out of the agent so the page numbers
// are reproducible and auditable rather than model-invented. The Website Builder
// receives the computed block and renders it.

import type { RoiInputs } from "./research.ts";

// Reference assumptions from the workflow doc.
const IT_TICKETS_PER_EMPLOYEE_YEAR = 10; // "10 IT-related support tickets"
const HR_INTERACTIONS_PER_EMPLOYEE_YEAR = 8; // "8 HR-related support interactions"

// Fully-weighted blended cost per contact before automation. Midpoints of the
// reference tier tables, weighted toward the high-volume low tiers (L1/Tier1),
// which dominate the mix per the volume distributions.
const IT_BLENDED_COST_PER_TICKET = 22; // L1 help desk floor, the dominant tier
const HR_BLENDED_COST_PER_INTERACTION = 18; // Tier 1 HR shared services floor

// Platform impact: the share of contact cost the AI platform removes, net of the
// residual handling cost on contacts it does not fully deflect. Three adoption
// scenarios bound the estimate (D38 requires all three).
interface Scenario {
  name: "conservative" | "expected" | "aggressive";
  itDeflection: number; // effective fraction of IT cost removed
  hrDeflection: number; // effective fraction of HR cost removed
}

const SCENARIOS: Scenario[] = [
  { name: "conservative", itDeflection: 0.4, hrDeflection: 0.45 },
  { name: "expected", itDeflection: 0.55, hrDeflection: 0.6 },
  { name: "aggressive", itDeflection: 0.7, hrDeflection: 0.72 },
];

// Investment assumptions from the workflow doc.
const ANNUAL_LICENSE = 1_500_000;
const IMPLEMENTATION = 200_000;

export interface RoiScenarioResult {
  name: Scenario["name"];
  grossAnnualSavings: number;
  netAnnualSavings: number; // after annual license
  roiPercent: number; // net annual savings over first-year total cost
}

export interface RoiModel {
  totalEmployees: number;
  itStaff: number;
  hrStaff: number;
  staffEstimated: boolean;
  annualItTickets: number;
  annualHrInteractions: number;
  annualLicenseCost: number;
  implementationCost: number;
  scenarios: RoiScenarioResult[];
  // The headline figure the page leads with: expected net annual savings.
  headlineNetAnnualSavings: number;
}

function round(n: number): number {
  return Math.round(n);
}

// Compute the model from the research ROI inputs. Headcount drives volume; the
// fixed formulas turn volume into a defensible dollar range.
export function computeRoi(inputs: RoiInputs): RoiModel {
  const employees = Math.max(0, Math.floor(inputs.total_employees));
  const annualItTickets = employees * IT_TICKETS_PER_EMPLOYEE_YEAR;
  const annualHrInteractions = employees * HR_INTERACTIONS_PER_EMPLOYEE_YEAR;

  const itAnnualCost = annualItTickets * IT_BLENDED_COST_PER_TICKET;
  const hrAnnualCost = annualHrInteractions * HR_BLENDED_COST_PER_INTERACTION;

  const scenarios: RoiScenarioResult[] = SCENARIOS.map((s) => {
    const gross = itAnnualCost * s.itDeflection + hrAnnualCost * s.hrDeflection;
    const net = gross - ANNUAL_LICENSE;
    const firstYearCost = ANNUAL_LICENSE + IMPLEMENTATION;
    const roiPercent = firstYearCost > 0 ? (net / firstYearCost) * 100 : 0;
    return {
      name: s.name,
      grossAnnualSavings: round(gross),
      netAnnualSavings: round(net),
      roiPercent: round(roiPercent),
    };
  });

  const expected = scenarios.find((s) => s.name === "expected");

  return {
    totalEmployees: employees,
    itStaff: inputs.it_staff,
    hrStaff: inputs.hr_staff,
    staffEstimated: inputs.estimated,
    annualItTickets,
    annualHrInteractions,
    annualLicenseCost: ANNUAL_LICENSE,
    implementationCost: IMPLEMENTATION,
    scenarios,
    headlineNetAnnualSavings: expected ? expected.netAnnualSavings : 0,
  };
}

// Format a dollar amount as a compact, page-ready string ($1.2M, $480K, $9,200).
export function formatDollars(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}$${Math.round(abs / 1_000)}K`;
  return `${sign}$${abs.toLocaleString("en-US")}`;
}
