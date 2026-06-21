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
import type {
  BoundValueModel,
  ValidatedInputs,
  ValueResult,
  VerticalEconomics,
  VerticalSpec,
} from "./types.ts";
import type { ProductProfile } from "../domain/entities.ts";
import { validateEconomicsShape } from "./contract.ts";

// Reference assumptions from the workflow doc.
const IT_TICKETS_PER_EMPLOYEE_YEAR = 10; // "10 IT-related support tickets"
const HR_INTERACTIONS_PER_EMPLOYEE_YEAR = 8; // "8 HR-related support interactions"

// Fully-weighted blended cost per contact before automation. Midpoints of the
// reference tier tables, weighted toward the high-volume low tiers (L1/Tier1),
// which dominate the mix per the volume distributions.
const IT_BLENDED_COST_PER_TICKET = 22; // L1 help desk floor, the dominant tier
const HR_BLENDED_COST_PER_INTERACTION = 18; // Tier 1 HR shared services floor

// Default 5-year adoption ramp. defaultEconomics() populates it and createCompute
// falls back to it when an economics object omits the curve (a custom Phase 2
// config may). One source so a deliberate change to the ramp edits one literal.
const DEFAULT_ADOPTION_CURVE = [0.5, 0.8, 1.0, 1.0, 1.0];

// The effectiveness keys createCompute reads from each scenario. validateEconomics
// requires every scenario to carry these, so a typo'd or missing key fails at save
// rather than silently computing zero deflection for that term and rendering wrong
// figures. Keep in lockstep with the keys createCompute reads below.
const REQUIRED_EFFECTIVENESS_KEYS = ["itDeflection", "hrDeflection"] as const;

// Validate a raw economics object (Phase 2) against the shared shape and disclosure
// policy plus this vertical's required effectiveness keys. saveProfile maps the
// throw to a 400 the seller can correct; createValueModel calls it again at build as
// a defense-in-depth guard for rows that reach the worker without passing save.
function validateEconomics(raw: unknown): VerticalEconomics {
  return validateEconomicsShape(raw, REQUIRED_EFFECTIVENESS_KEYS);
}

// Default economics for the employee-service vertical. Phase 1 always returns
// these values; Phase 2 reads profile.economics when present and falls back to
// these when null. Extracted from hardcoded constants to support multi-customer
// use of the same vertical with different product pricing (Concern #1).
function defaultEconomics(): VerticalEconomics {
  return {
    annual_license: 1_500_000,
    implementation_fee: 200_000,
    scenarios: [
      { name: "Conservative", effectiveness: { itDeflection: 0.4, hrDeflection: 0.45 } },
      { name: "Expected", effectiveness: { itDeflection: 0.55, hrDeflection: 0.6 } },
      { name: "Aggressive", effectiveness: { itDeflection: 0.7, hrDeflection: 0.72 } },
    ],
    adoption_curve: DEFAULT_ADOPTION_CURVE,
  };
}

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

// Factory: create a compute function bound to the given economics. The returned
// function is pure (inputs → ValueResult) while the economics flow through the
// closure. Phase 1 always passes defaultEconomics(); Phase 2 passes per-customer
// economics when profile.economics is populated.
function createCompute(economics: VerticalEconomics) {
  return (inputs: ValidatedInputs): ValueResult => {
    const employees = Math.max(0, Math.floor(inputs.values.total_employees ?? 0));
    const annualItTickets = employees * IT_TICKETS_PER_EMPLOYEE_YEAR;
    const annualHrInteractions = employees * HR_INTERACTIONS_PER_EMPLOYEE_YEAR;

    const itAnnualCost = annualItTickets * IT_BLENDED_COST_PER_TICKET;
    const hrAnnualCost = annualHrInteractions * HR_BLENDED_COST_PER_INTERACTION;

    const firstYearCost = economics.annual_license + economics.implementation_fee;

    const scenarios = economics.scenarios.map((s) => {
      const itDeflection = s.effectiveness.itDeflection ?? 0;
      const hrDeflection = s.effectiveness.hrDeflection ?? 0;
      const gross = itAnnualCost * itDeflection + hrAnnualCost * hrDeflection;
      const net = gross - economics.annual_license;
      const roiPercent = firstYearCost > 0 ? (net / firstYearCost) * 100 : 0;
      return {
        name: s.name,
        primaryValue: formatDollars(round(net)),
        primaryLabel: "Net Annual Savings",
        secondary: `${round(roiPercent)}% ROI`,
      };
    });

    const expectedScenario = economics.scenarios[1]!;
    const expectedGross =
      itAnnualCost * (expectedScenario.effectiveness.itDeflection ?? 0) +
      hrAnnualCost * (expectedScenario.effectiveness.hrDeflection ?? 0);
    const expectedNet = round(expectedGross - economics.annual_license);

    // Payback: total first-year investment divided by monthly gross savings.
    // Guard against zero headcount: expectedGross of 0 produces Infinity otherwise.
    const paybackValue =
      expectedGross > 0 ? `${(firstYearCost / (expectedGross / 12)).toFixed(1)} mo` : "n/a";

    // Annual cash flows follow the adoption ramp; year 1 absorbs the implementation fee.
    const adoption = economics.adoption_curve ?? DEFAULT_ADOPTION_CURVE;
    const annualCashFlows = adoption.map((ramp, i) => {
      const yearNumber = i + 1;
      return (
        ramp * expectedGross -
        economics.annual_license -
        (yearNumber === 1 ? economics.implementation_fee : 0)
      );
    });

    // Cumulative series: each point sums all flows up to and including that year.
    let runningTotal = 0;
    const series = annualCashFlows.map((flow, i) => {
      runningTotal += flow;
      const rounded = round(runningTotal);
      return {
        period: `Year ${i + 1}`,
        value: rounded,
        display: formatDollars(rounded),
      };
    });

    const cumulative5 = runningTotal;

    // NPV at 8%: discount each year's cash flow back to present value, then round.
    const npv = round(annualCashFlows.reduce((sum, flow, i) => sum + flow / 1.08 ** (i + 1), 0));

    return {
      sectionTitle: "Business Value",
      headline: { label: "Expected net annual savings", value: formatDollars(expectedNet) },
      scenarios,
      footnote: inputs.estimated ? "Staff counts estimated from industry benchmarks." : undefined,
      metrics: [
        { label: "Expected ROI", value: `${round((expectedNet / firstYearCost) * 100)}%` },
        { label: "Payback period", value: paybackValue },
        { label: "5-year net savings", value: formatDollars(round(cumulative5)) },
        { label: "NPV at 8 percent", value: formatDollars(npv) },
      ],
      projection: {
        label: "Cumulative net cash flow",
        unit: "USD",
        series,
      },
    };
  };
}

// Input guidance for the research agent Phase 4. Exposed on the VerticalSpec
// (not just the bound value model) so the research agent kickoff can inject it
// without needing a product profile.
const inputGuidance = `Gather headcount as numeric value_inputs:
- total_employees: total global headcount (required).
- it_staff: IT Service Desk reps, help desk staff, or IT support managers. Usually not public; if unavailable, estimate at roughly 0.5% to 1% of total employees.
- hr_staff: HR Service Desk reps or HR shared services staff. Usually not public; estimate at roughly 0.1% to 0.3% of total employees if needed.
Use actual counts when you find them in job postings, org charts, or releases, and set estimated: false. Otherwise estimate and set estimated: true.`;

// Factory: create a value model bound to the customer's economics. Reads
// profile.economics when present (migration 0007) and validates its shape;
// falls back to defaultEconomics() when null, so existing profiles keep the
// Phase 1 figures. A malformed economics object throws ValueModelContractError,
// which the worker classifies as a permanent build failure.
function createValueModel(profile: ProductProfile): BoundValueModel {
  const economics = profile.economics ? validateEconomics(profile.economics) : defaultEconomics();

  return {
    inputGuidance,
    validateInputs,
    compute: createCompute(economics),
    economics,
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
  inputGuidance, // exposed directly for research agent kickoff
  validateInputs, // exposed directly for validateResearch early gate
  createValueModel,
  defaultEconomics,
  validateEconomics, // exposed for saveProfile's save-time gate
};
