// The Sales and Marketing vertical: Mirenta's own go-to-market segment, the spec
// the self-sell demo declares. It spans two domains (Sales and Marketing) the way
// the employee-service vertical spans HR and ITSM, and it targets revenue and
// demand-generation leaders rather than HR/IT.
//
// The value model is pipeline-uplift, not cost-deflection: Mirenta lifts the rate
// at which outbound books qualified meetings, so the model turns a rep roster and
// an average deal size into incremental booked meetings, incremental closed-won
// deals, and the net new annual revenue that follows, across the three disclosure
// scenarios. The model invents no numbers: every figure derives deterministically
// from the research value inputs and the scenario uplift. The builder renders the
// computed ValueResult; the worker never lets the model author a figure (D9, D54).

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

// Funnel assumption: the share of incremental booked meetings that become a
// closed-won deal. A single blended rate keeps the model defensible and auditable;
// a finer meeting -> opportunity -> won split is a fast-follow if the inputs warrant
// it. Held at a conservative floor so the model does not overstate the win.
const MEETING_TO_WON_RATE = 0.05;

// Fallback annual booked meetings per quota-carrying rep when the research does not
// surface the figure. The research agent estimates it from benchmarks and sets
// estimated: true; this constant only guards a missing input so compute never reads
// undefined and silently produces zero.
const DEFAULT_MEETINGS_PER_REP_YEAR = 60;

// Default 5-year adoption ramp. defaultEconomics populates it and createCompute
// falls back to it when an economics object omits the curve. One source so a
// deliberate change to the ramp edits one literal.
const DEFAULT_ADOPTION_CURVE = [0.5, 0.8, 1.0, 1.0, 1.0];

// The effectiveness key createCompute reads from each scenario: the fractional lift
// in booked meetings Mirenta drives. validateEconomics requires every scenario to
// carry it, so a typo'd or missing key fails at save rather than computing a silent
// zero uplift. Keep in lockstep with the key createCompute reads below.
const REQUIRED_EFFECTIVENESS_KEYS = ["meeting_uplift"] as const;

// Default economics for the sales-marketing vertical. Phase 1 always returns these;
// a profile.economics override (migration 0007) replaces them when present and
// validateEconomics passes. The license and implementation fee reflect a mid-market
// outbound-tooling deal; the per-scenario meeting_uplift bounds the estimate.
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

// Narrow the generic numeric map to the sales-marketing inputs. The rep roster and
// the average deal size drive the model and are required; the baseline meetings per
// rep falls back to a benchmark when the research does not surface it.
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

// Factory: create a compute function bound to the given economics. Pure
// (inputs -> ValueResult); the economics flow through the closure.
function createCompute(economics: VerticalEconomics) {
  return (inputs: ValidatedInputs): ValueResult => {
    const reps = Math.max(0, Math.floor(inputs.values.quota_carrying_reps ?? 0));
    const dealSize = Math.max(0, inputs.values.avg_deal_size ?? 0);
    const meetingsPerRep = Math.max(0, inputs.values.baseline_meetings_per_rep_year ?? 0);
    const baselineMeetings = reps * meetingsPerRep;

    const firstYearCost = economics.annual_license + economics.implementation_fee;

    // Each scenario: the meeting uplift turns baseline meetings into incremental
    // booked meetings, the funnel rate turns those into incremental closed-won
    // deals, and the deal size turns those into net new annual revenue.
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

    // Payback: total first-year investment divided by monthly gross revenue.
    // Guard against a zero funnel: expectedGross of 0 produces Infinity otherwise.
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
  quoteTargeting: `Source quotes from the prospect company's sales and marketing leaders or official spokespeople: a direct statement from an interview, a press release, a LinkedIn post, or a company blog that speaks to the revenue and demand-generation priorities your research surfaces. Apply the D37 rigor to every quote: re-fetch the source, confirm the wording, set verified true only on a confirmed match, and drop any quote that fails. Invent no quote, speaker, or source. Return no quotes rather than weaken the bar.`,
  defaultAccentColor: "#2563eb",
  inputGuidance, // exposed directly for the research agent kickoff
  validateInputs, // exposed directly for the validateResearch early gate
  createValueModel,
  defaultEconomics,
  validateEconomics, // exposed for saveProfile's save-time gate
};
