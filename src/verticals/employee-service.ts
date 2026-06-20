// The Salesforce HR/ITSM employee-service vertical: the MVP's first registered
// spec. Every HR/ITSM-specific assumption that used to live in the generic core
// (the domain set, the executive targets, the support-deflection value math)
// lives here as data and code behind the VerticalSpec seam.
//
// The value model moves the deterministic ROI math intact from the former
// domain/roi.ts (D38, D49): apply fixed per-employee ticket and interaction
// volumes to headcount, present net annual savings across conservative,
// expected, and aggressive scenarios. The model never invents numbers; the
// builder renders the computed ValueResult.

import { formatDollars } from "../domain/format.ts";
import type { ValidatedInputs, ValueResult, VerticalSpec } from "./types.ts";

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
interface DeflectionScenario {
  name: string; // display label, rendered directly on the page
  itDeflection: number; // effective fraction of IT cost removed
  hrDeflection: number; // effective fraction of HR cost removed
}

const SCENARIOS: DeflectionScenario[] = [
  { name: "Conservative", itDeflection: 0.4, hrDeflection: 0.45 },
  { name: "Expected", itDeflection: 0.55, hrDeflection: 0.6 },
  { name: "Aggressive", itDeflection: 0.7, hrDeflection: 0.72 },
];

// Investment assumptions from the workflow doc.
const ANNUAL_LICENSE = 1_500_000;
const IMPLEMENTATION = 200_000;

function round(n: number): number {
  return Math.round(n);
}

// Narrow the generic numeric map to the employee-service inputs. Headcount is
// required; the staff counts default to 0 when absent (the current model does
// not consume them, but they persist for the future full Step 4 model, D49).
function validateInputs(raw: Record<string, number>, estimated: boolean): ValidatedInputs {
  if (typeof raw.total_employees !== "number") {
    throw new Error("research.extension.value_inputs.total_employees missing");
  }
  return {
    values: {
      total_employees: raw.total_employees,
      it_staff: typeof raw.it_staff === "number" ? raw.it_staff : 0,
      hr_staff: typeof raw.hr_staff === "number" ? raw.hr_staff : 0,
    },
    estimated,
  };
}

// Compute the model from the validated inputs. Headcount drives volume; the
// fixed formulas turn volume into a defensible dollar range.
function compute(inputs: ValidatedInputs): ValueResult {
  const employees = Math.max(0, Math.floor(inputs.values.total_employees ?? 0));
  const annualItTickets = employees * IT_TICKETS_PER_EMPLOYEE_YEAR;
  const annualHrInteractions = employees * HR_INTERACTIONS_PER_EMPLOYEE_YEAR;

  const itAnnualCost = annualItTickets * IT_BLENDED_COST_PER_TICKET;
  const hrAnnualCost = annualHrInteractions * HR_BLENDED_COST_PER_INTERACTION;

  const firstYearCost = ANNUAL_LICENSE + IMPLEMENTATION;

  const scenarios = SCENARIOS.map((s) => {
    const gross = itAnnualCost * s.itDeflection + hrAnnualCost * s.hrDeflection;
    const net = gross - ANNUAL_LICENSE;
    const roiPercent = firstYearCost > 0 ? (net / firstYearCost) * 100 : 0;
    return {
      name: s.name,
      primaryValue: formatDollars(round(net)),
      primaryLabel: "Net Annual Savings",
      secondary: `${round(roiPercent)}% ROI`,
    };
  });

  const expectedGross =
    itAnnualCost * SCENARIOS[1]!.itDeflection + hrAnnualCost * SCENARIOS[1]!.hrDeflection;
  const expectedNet = round(expectedGross - ANNUAL_LICENSE);

  return {
    sectionTitle: "Business Value",
    headline: { label: "Expected net annual savings", value: formatDollars(expectedNet) },
    scenarios,
    footnote: inputs.estimated
      ? "Staff counts estimated from industry benchmarks."
      : undefined,
  };
}

export const employeeServiceVertical: VerticalSpec = {
  id: "salesforce_employee_service",
  label: "Salesforce Employee Service (HR and ITSM)",
  domains: ["HR", "ITSM"],
  domainGuidance: `Surface the top priorities in HR and ITSM through an executive lens: what matters to the VP of HR, CHRO, CIO, or VP of IT, and why now. Frame each domain priority as a point of view (POV): a stance on what the buyer recognizes as their own priorities.`,
  executiveTargeting: `Prioritize:
- HR leadership (CHRO, VP of HR)
- ITSM leadership (CIO, VP of IT)
- C-suite (CEO, President, COO)`,
  defaultAccentColor: "#0176d3", // Salesforce blue
  valueModel: {
    inputGuidance: `Gather headcount as numeric value_inputs:
- total_employees: total global headcount (required).
- it_staff: IT Service Desk reps, help desk staff, or IT support managers. Usually not public; if unavailable, estimate at roughly 0.5% to 1% of total employees.
- hr_staff: HR Service Desk reps or HR shared services staff. Usually not public; estimate at roughly 0.1% to 0.3% of total employees if needed.
Use actual counts when you find them in job postings, org charts, or releases, and set estimated: false. Otherwise estimate and set estimated: true.`,
    validateInputs,
    compute,
  },
};
