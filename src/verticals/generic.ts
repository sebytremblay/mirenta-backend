import type {
  BoundValueModel,
  ValidatedInputs,
  ValueResult,
  VerticalEconomics,
  VerticalSpec,
} from "./types.ts";
import type { ProductProfile } from "../domain/entities.ts";
import { DISCLOSURE_SCENARIO_NAMES, validateEconomicsShape } from "./contract.ts";

const REQUIRED_EFFECTIVENESS_KEYS: readonly string[] = [];

const SCENARIO_VALUES: Record<string, { primaryValue: string; primaryLabel: string }> = {
  Conservative: { primaryValue: "Qualified interest", primaryLabel: "Likely outcome" },
  Expected: { primaryValue: "An engaged conversation", primaryLabel: "Likely outcome" },
  Aggressive: { primaryValue: "A booked working session", primaryLabel: "Likely outcome" },
};

function defaultEconomics(): VerticalEconomics {
  return {
    annual_license: 0,
    implementation_fee: 0,
    scenarios: DISCLOSURE_SCENARIO_NAMES.map((name) => ({ name, effectiveness: {} })),
  };
}

function validateEconomics(raw: unknown): VerticalEconomics {
  return validateEconomicsShape(raw, REQUIRED_EFFECTIVENESS_KEYS);
}

function validateInputs(raw: Record<string, number>, estimated: boolean): ValidatedInputs {
  return { values: { ...raw }, estimated };
}

function compute(inputs: ValidatedInputs): ValueResult {
  return {
    sectionTitle: "Why this matters",
    headline: {
      label: "The case this page makes",
      value: "A research-led conversation in the prospect's own language",
    },
    scenarios: DISCLOSURE_SCENARIO_NAMES.map((name) => ({
      name,
      primaryValue: SCENARIO_VALUES[name]!.primaryValue,
      primaryLabel: SCENARIO_VALUES[name]!.primaryLabel,
    })),
    footnote: inputs.estimated
      ? "This page frames a qualitative point of view, not a modeled financial projection."
      : undefined,
  };
}

const inputGuidance = `Gather no fixed numeric value_inputs for this horizontal vertical. The business-value block is qualitative. If the prospect publishes a headline figure that the seller's value proposition speaks to directly (for example total employees, annual revenue, or customer count), include it in value_inputs as a single numeric key and set estimated accordingly; otherwise leave value_inputs empty.`;

function createValueModel(profile: ProductProfile): BoundValueModel {
  const economics = profile.economics ? validateEconomics(profile.economics) : defaultEconomics();
  return {
    inputGuidance,
    validateInputs,
    compute,
    economics,
  };
}

export const genericVertical: VerticalSpec = {
  id: "generic",
  label: "Generic (horizontal)",
  domains: ["Strategic priorities", "Operational priorities"],
  domainGuidance: `Derive the prospect's top priorities from the seller's own value proposition and the prospect's stated goals, not from any fixed industry. Read what the company says about its mission, recent strategic moves, and public commitments, then surface the priorities the seller's product speaks to directly. Frame each as a point of view (POV): a stance the buyer recognizes as their own priority.`,
  executiveTargeting: `Prioritize the leaders who own the problem the seller solves:
- The economic buyer (the executive who controls the budget for this category)
- The decision maker and likely champion (the leader whose team feels the problem)
- Relevant functional leaders the seller's value proposition names
- C-suite (CEO, President, COO) when the priority is company-wide`,
  defaultAccentColor: "#3b5bdb",
  inputGuidance,
  validateInputs,
  createValueModel,
  defaultEconomics,
  validateEconomics,
};
