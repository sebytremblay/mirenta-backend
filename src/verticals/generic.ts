// The generic, horizontal vertical: the registry's neutral fallback. A product
// profile that declares no vertical resolves to this spec, so an un-configured
// customer researches and renders through a vertical-neutral lens rather than
// inheriting another vertical's industry assumptions (the HR/ITSM leak this
// vertical closes). It carries NO industry, domain, or support-deflection
// assumption: the research agent derives priorities from the seller's own value
// proposition and the prospect's stated goals.
//
// The value model produces a qualitative business-value block. Mirenta does not
// know a horizontal seller's economics, so the generic model invents no figures:
// it omits the ROI metric tiles and the cumulative projection (both optional on
// ValueResult) and renders the three disclosure scenarios with product-framed
// qualitative value. The seam still requires exactly three scenarios named per the
// D38/D49 disclosure policy, so the block stays structurally consistent with every
// other vertical's.

import type {
  BoundValueModel,
  ValidatedInputs,
  ValueResult,
  VerticalEconomics,
  VerticalSpec,
} from "./types.ts";
import type { ProductProfile } from "../domain/entities.ts";
import { DISCLOSURE_SCENARIO_NAMES, validateEconomicsShape } from "./contract.ts";

// The generic value model reads no economics effectiveness keys: it computes no
// figures. defaultEconomics still supplies the disclosure-compliant scaffold so a
// profile may carry an economics override without breaking the save-time gate, and
// validateEconomics enforces the shared shape with no required effectiveness key.
const REQUIRED_EFFECTIVENESS_KEYS: readonly string[] = [];

// Qualitative scenario framing. Each scenario describes the strength of the case a
// hyper-personalized one-pager makes, not a dollar figure, so the model invents no
// numbers. The names match the D38/D49 disclosure policy in order.
const SCENARIO_VALUES: Record<string, { primaryValue: string; primaryLabel: string }> = {
  Conservative: { primaryValue: "Qualified interest", primaryLabel: "Likely outcome" },
  Expected: { primaryValue: "An engaged conversation", primaryLabel: "Likely outcome" },
  Aggressive: { primaryValue: "A booked working session", primaryLabel: "Likely outcome" },
};

function defaultEconomics(): VerticalEconomics {
  return {
    annual_license: 0,
    implementation_fee: 0,
    // Three disclosure-compliant scenarios with empty effectiveness maps: the
    // generic model reads no effectiveness key, so none is required or consumed.
    scenarios: DISCLOSURE_SCENARIO_NAMES.map((name) => ({ name, effectiveness: {} })),
  };
}

function validateEconomics(raw: unknown): VerticalEconomics {
  return validateEconomicsShape(raw, REQUIRED_EFFECTIVENESS_KEYS);
}

// The generic vertical consumes no numeric inputs. It accepts whatever the research
// agent gathers and carries it through untouched, so a horizontal seller is never
// forced to supply a figure the model does not use.
function validateInputs(raw: Record<string, number>, estimated: boolean): ValidatedInputs {
  return { values: { ...raw }, estimated };
}

// A qualitative ValueResult: headline plus the three disclosure scenarios, with no
// metric tiles and no projection chart. renderValueBlock and the page validator both
// degrade cleanly when metrics and projection are absent.
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
  quoteTargeting: `Source quotes from the prospect company's executives or official spokespeople: a direct statement from an interview, a press release, a LinkedIn post, or a company blog that speaks to the priorities your research surfaces. Apply the D37 rigor to every quote: re-fetch the source, confirm the wording, set verified true only on a confirmed match, and drop any quote that fails. Invent no quote, speaker, or source. Return no quotes rather than weaken the bar.`,
  defaultAccentColor: "#3b5bdb",
  inputGuidance, // exposed directly for the research agent kickoff
  validateInputs, // exposed directly for the validateResearch early gate
  createValueModel,
  defaultEconomics,
  validateEconomics, // exposed for saveProfile's save-time gate
};
