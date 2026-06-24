import type {
  BoundValueModel,
  ValidatedInputs,
  ValueResult,
  VerticalEconomics,
  VerticalSpec,
} from "./types.ts";
import type { ProductProfile } from "../domain/entities.ts";
import { ValueModelContractError } from "./contract.ts";

// The stage bands this vertical recognizes. The value unit is a time range, and
// the band picks the range. Each band names a public raise signal the agent can
// source rather than a number the founder must disclose.
const KNOWN_BANDS = ["pre_seed", "seed", "series_a"] as const;
type StageBand = (typeof KNOWN_BANDS)[number];

function isStageBand(value: string): value is StageBand {
  return (KNOWN_BANDS as readonly string[]).includes(value);
}

function isHoursPair(value: unknown): value is [number, number] {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    typeof value[0] === "number" &&
    Number.isFinite(value[0]) &&
    typeof value[1] === "number" &&
    Number.isFinite(value[1])
  );
}

// This vertical owns its economics shape. `band_hours` maps each stage band to
// the [low, high] founder-hours the band reclaims each week; compute reads the
// pair for the band research carried and renders it verbatim.
function defaultEconomics(): VerticalEconomics {
  return {
    band_hours: {
      pre_seed: [2, 4],
      seed: [4, 6],
      series_a: [6, 9],
    },
  };
}

function validateEconomics(raw: unknown): VerticalEconomics {
  if (typeof raw !== "object" || raw === null) {
    throw new ValueModelContractError("sales_marketing economics must be an object");
  }
  const bandHours = (raw as Record<string, unknown>).band_hours;
  if (typeof bandHours !== "object" || bandHours === null) {
    throw new ValueModelContractError("sales_marketing economics.band_hours must be an object");
  }
  const map = bandHours as Record<string, unknown>;
  for (const band of KNOWN_BANDS) {
    if (!isHoursPair(map[band])) {
      throw new ValueModelContractError(
        `sales_marketing economics.band_hours.${band} must be a [number, number] pair`,
      );
    }
  }
  return raw as VerticalEconomics;
}

function validateInputs(
  raw: Record<string, number>,
  estimated: boolean,
  context: Record<string, string> = {},
): ValidatedInputs {
  const band = context.stage_band;
  if (typeof band !== "string" || !isStageBand(band)) {
    throw new Error(
      "research.extension.context.stage_band must be one of pre_seed, seed, series_a",
    );
  }
  return {
    values: { ...raw },
    context: { stage_band: band },
    estimated,
  };
}

function createCompute(economics: VerticalEconomics) {
  const bandHours = (economics as { band_hours: Record<string, [number, number]> }).band_hours;
  return (inputs: ValidatedInputs): ValueResult => {
    // validateInputs already narrowed stage_band to a known band, so the lookup
    // resolves; fall back to the seed band defensively for the type checker.
    const band = inputs.context.stage_band ?? "seed";
    const [lo, hi] = bandHours[band] ?? bandHours.seed ?? [0, 0];
    return {
      sectionTitle: "What this frees up",
      headline: {
        label: "Founder time reclaimed",
        value: `~${lo} to ${hi} founder-hours reclaimed each week`,
      },
      mechanism: `Founders at the ${band.replace(/_/g, " ")} stage run the go-to-market motion by hand, so the reclaimed-hours benchmark for that stage measures the weekly load this lifts off the founder.`,
      footnote: inputs.estimated
        ? "The reclaimed-hours figure draws on a stage-band benchmark, not the founder's own measured week, and serves as illustration pending a conversation."
        : undefined,
    };
  };
}

const inputGuidance = `Gather no numeric value_inputs for this vertical. Set extension.context.stage_band to exactly one of pre_seed, seed, or series_a, sourced from public raise signals (funding announcements, the company's own posts, investor portfolio pages, or filings). Set estimated: true when you infer the band from indirect signals rather than a stated round, and estimated: false when a public source names the round outright.`;

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
  domainGuidance: `Surface the go-to-market problem the founder ships against: finding the first repeatable channel, writing the messaging that earns a reply, booking the early pipeline by hand, and turning interest into committed customers. Frame each domain priority as a point of view (POV): a stance on what the founder recognizes as their own priority right now, and why now.`,
  voiceTargeting: `Prioritize voices across the self, backer, and tribe ladder:
- self: the founder's own posts, talks, and writing on sales and marketing
- backer: the investors and angels who funded the founder and speak to their go-to-market thesis
- tribe: the revered voices of the sales-and-marketing founder's domain whom the founder cites or follows`,
  defaultAccentColor: "#2563eb",
  inputGuidance,
  validateInputs,
  createValueModel,
  defaultEconomics,
  validateEconomics,
};
