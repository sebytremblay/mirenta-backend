import type {
  BoundValueModel,
  ValidatedInputs,
  ValueResult,
  VerticalEconomics,
  VerticalSpec,
} from "./types.ts";
import type { ProductProfile } from "../domain/entities.ts";
import { ValueModelContractError } from "./contract.ts";

function defaultEconomics(): VerticalEconomics {
  return {};
}

function validateEconomics(raw: unknown): VerticalEconomics {
  if (typeof raw !== "object" || raw === null) {
    throw new ValueModelContractError("economics must be an object");
  }
  return raw as VerticalEconomics;
}

function validateInputs(
  raw: Record<string, number>,
  estimated: boolean,
  context: Record<string, string> = {},
): ValidatedInputs {
  return { values: { ...raw }, context: { ...context }, estimated };
}

function compute(inputs: ValidatedInputs): ValueResult {
  return {
    sectionTitle: "Why this matters",
    headline: {
      label: "The case this page makes",
      value: "A research-led conversation in the founder's own language",
    },
    mechanism:
      "The page reads the founder's public trail, mirrors the priorities they already name, and meets them where they stand.",
    footnote: inputs.estimated
      ? "This page frames a point of view drawn from the founder's public signals, not a modeled projection."
      : undefined,
  };
}

const inputGuidance = `Gather no numeric value_inputs and no context keys for this default vertical. The value claim is qualitative: the page states a point of view in the founder's own language rather than a figure.`;

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
  domainGuidance: `Read the founder's world, not a fixed industry. Surface the priorities the founder ships against right now: speed, traction, survival, the next milestone, and the problem they wake up solving. Draw each from what the founder says in public about their mission, their recent moves, and the bet they are making, then frame it as a point of view the founder recognizes as their own.`,
  voiceTargeting: `Reach the founder through the voices they already respect across the self, backer, and tribe ladder:
- Self: the founder's own words from talks, posts, and interviews
- Backer: the investors and angels who funded the bet and speak to it in public
- Tribe: the revered figures of the founder's domain whose canon the founder cites`,
  defaultAccentColor: "#3b5bdb",
  inputGuidance,
  validateInputs,
  createValueModel,
  defaultEconomics,
  validateEconomics,
};
