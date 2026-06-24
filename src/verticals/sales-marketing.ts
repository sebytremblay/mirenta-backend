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

const MEETING_TO_WON_RATE = 0.05;

const DEFAULT_MEETINGS_PER_REP_YEAR = 60;

const DEFAULT_ADOPTION_CURVE = [0.5, 0.8, 1.0, 1.0, 1.0];

// Keep in lockstep with the key createCompute reads.
const REQUIRED_EFFECTIVENESS_KEYS = ["meeting_uplift"] as const;

function defaultEconomics(): VerticalEconomics {
  return {
    annual_license: 150_000,
    implementation_fee: 30_000,
    scenarios: [
      { name: "Conservative", effectiveness: { meeting_uplift: 0.1 } },
      { name: "Expected", effectiveness: { meeting_uplift: 0.2 } },
      { name: "Aggressive", effectiveness: { meeting_uplift: 0.35 } },
    ],
    adoption_curve: DEFAULT_ADOPTION_CURVE,
  };
}

function round(n: number): number {
  return Math.round(n);
}

function validateEconomics(raw: unknown): VerticalEconomics {
  return validateEconomicsShape(raw, REQUIRED_EFFECTIVENESS_KEYS);
}

function validateInputs(raw: Record<string, number>, estimated: boolean): ValidatedInputs {
  if (typeof raw.quota_carrying_reps !== "number") {
    throw new Error("research.extension.value_inputs.quota_carrying_reps missing");
  }
  if (typeof raw.avg_deal_size !== "number") {
    throw new Error("research.extension.value_inputs.avg_deal_size missing");
  }
  return {
    values: {
      quota_carrying_reps: raw.quota_carrying_reps,
      avg_deal_size: raw.avg_deal_size,
      baseline_meetings_per_rep_year:
        typeof raw.baseline_meetings_per_rep_year === "number"
          ? raw.baseline_meetings_per_rep_year
          : DEFAULT_MEETINGS_PER_REP_YEAR,
    },
    estimated,
  };
}

function createCompute(economics: VerticalEconomics) {
  return (inputs: ValidatedInputs): ValueResult => {
    const reps = Math.max(0, Math.floor(inputs.values.quota_carrying_reps ?? 0));
    const dealSize = Math.max(0, inputs.values.avg_deal_size ?? 0);
    const meetingsPerRep = Math.max(0, inputs.values.baseline_meetings_per_rep_year ?? 0);
    const baselineMeetings = reps * meetingsPerRep;

    const firstYearCost = economics.annual_license + economics.implementation_fee;

    const scenarios = economics.scenarios.map((s) => {
      const uplift = s.effectiveness.meeting_uplift ?? 0;
      const incrementalMeetings = baselineMeetings * uplift;
      const incrementalWonDeals = incrementalMeetings * MEETING_TO_WON_RATE;
      const gross = incrementalWonDeals * dealSize;
      const net = gross - economics.annual_license;
      const roiPercent = firstYearCost > 0 ? (net / firstYearCost) * 100 : 0;
      return {
        name: s.name,
        primaryValue: formatDollars(round(net)),
        primaryLabel: "Net new annual revenue",
        secondary: `${round(roiPercent)}% ROI`,
      };
    });

    const expectedUplift = economics.scenarios[1]!.effectiveness.meeting_uplift ?? 0;
    const expectedIncrementalMeetings = baselineMeetings * expectedUplift;
    const expectedGross = expectedIncrementalMeetings * MEETING_TO_WON_RATE * dealSize;
    const expectedNet = round(expectedGross - economics.annual_license);

    const paybackValue =
      expectedGross > 0 ? `${(firstYearCost / (expectedGross / 12)).toFixed(1)} mo` : "n/a";

    const adoption = economics.adoption_curve ?? DEFAULT_ADOPTION_CURVE;
    const annualCashFlows = adoption.map((ramp, i) => {
      const yearNumber = i + 1;
      return (
        ramp * expectedGross -
        economics.annual_license -
        (yearNumber === 1 ? economics.implementation_fee : 0)
      );
    });

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
    const npv = round(annualCashFlows.reduce((sum, flow, i) => sum + flow / 1.08 ** (i + 1), 0));

    return {
      sectionTitle: "Business Value",
      headline: { label: "Expected net new annual revenue", value: formatDollars(expectedNet) },
      scenarios,
      footnote: inputs.estimated
        ? "Pipeline and revenue figures model industry benchmarks and serve as illustration pending discovery."
        : undefined,
      metrics: [
        { label: "Expected ROI", value: `${round((expectedNet / firstYearCost) * 100)}%` },
        { label: "Payback period", value: paybackValue },
        { label: "5-year net new revenue", value: formatDollars(round(cumulative5)) },
        { label: "NPV at 8 percent", value: formatDollars(npv) },
      ],
      projection: {
        label: "Cumulative net new revenue",
        unit: "USD",
        series,
      },
    };
  };
}

const inputGuidance = `Gather the outbound funnel drivers as numeric value_inputs:
- quota_carrying_reps: the number of quota-carrying sales reps running outbound (required). Source from job postings, the sales-team page, or LinkedIn headcount.
- avg_deal_size: average annual contract or deal value in USD (required). Source from pricing pages, case studies, or filings; estimate from the segment when not public.
- baseline_meetings_per_rep_year: booked qualified meetings per rep per year today. Usually not public; estimate from benchmarks when unavailable.
Use actual figures when you find them and set estimated: false. Otherwise estimate and set estimated: true.`;

function createValueModel(profile: ProductProfile): BoundValueModel {
  const economics = profile.economics ? validateEconomics(profile.economics) : defaultEconomics();
  return {
    inputGuidance,
    validateInputs,
    compute: createCompute(economics),
    economics,
  };
}

export const salesMarketingVertical: VerticalSpec = {
  id: "sales_marketing",
  label: "Sales and Marketing",
  domains: ["Sales", "Marketing"],
  domainGuidance: `Surface the top priorities in Sales and Marketing through an executive lens: pipeline generation, outbound efficiency and reply rates, win rates and sales productivity, demand generation, and campaign return. Frame each domain priority as a point of view (POV): a stance on what the revenue leader recognizes as their own priority, and why now.`,
  executiveTargeting: `Prioritize:
- Sales leadership (CRO, VP of Sales, Head of Sales Development)
- Marketing leadership (CMO, VP of Marketing, VP of Demand Generation)
- C-suite (CEO, President, COO)`,
  defaultAccentColor: "#2563eb",
  inputGuidance,
  validateInputs,
  createValueModel,
  defaultEconomics,
  validateEconomics,
};
