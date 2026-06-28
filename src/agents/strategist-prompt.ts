// The strategist's pure parts: the tool schema, the system prompt, the prompt
// builder, and the output validator. These touch no provider and read no env, so
// the unit test exercises them directly. The runner in strategist.ts pairs these
// with the Anthropic call.

import {
  RECIPE_OPS,
  RECIPE_UNITS,
  type MetricRecipe,
} from "../domain/recipe.ts";
import type { Lead, ProductProfile } from "../domain/entities.ts";

export const EMIT_STRATEGY_TOOL = "emit_strategy";

// The research plan: what the research agent investigates and which voices it
// hunts, generalized from the old per-vertical guidance to a per-lead plan.
export interface ResearchPlan {
  // The domains to organize the founder's priorities around, named for this lead.
  domains: string[];
  // Guidance for the self/backer/tribe voice hunt, tuned to this founder's world.
  voiceTargeting: string;
  // Guidance for sourcing each recipe input as a fact, naming where to look.
  inputSourcing: string;
}

export interface Strategy {
  plan: ResearchPlan;
  recipe: MetricRecipe;
}

export interface StrategistInput {
  lead: Pick<Lead, "first_name" | "last_name" | "role" | "company" | "website_url">;
  profile: Pick<ProductProfile, "company_name" | "product_name" | "value_prop">;
  onStep?: (step: { phase: string; detail: string }) => void;
}

const RECIPE_SCHEMA = {
  type: "object",
  properties: {
    op: { type: "string", enum: [...RECIPE_OPS] },
    unit: { type: "string", enum: [...RECIPE_UNITS] },
    sectionTitle: { type: "string" },
    headlineLabel: { type: "string" },
    mechanismTemplate: {
      type: "string",
      description:
        "One plain sentence the evaluator fills. Tokens: {result} (the final figure, already carrying its unit, for example \"~28 hours each week\" or \"$15,000 to $35,000 per year\"); {value.<key>} (the sourced NUMBER for an input, for example \"14\"); {input.<key>} (the input's human label). Use {value.<key>} wherever the sentence reads as a number and {input.<key>} only as a noun phrase. Write no unit word after {result}; it already carries one. Never write the figure yourself.",
    },
    inputs: {
      type: "array",
      items: {
        type: "object",
        properties: {
          key: { type: "string" },
          label: { type: "string" },
          min: { type: "number" },
          max: { type: "number" },
        },
        required: ["key", "label", "min", "max"],
      },
    },
    maxFactor: { type: "number", description: "Required ceiling on a multiply product." },
    resultCeiling: { type: "number", description: "Required absolute cap on the computed result." },
    literalValue: { type: "string", description: "The qualitative claim for op identity + unit qualitative." },
    numeratorKey: { type: "string", description: "Required for op ratio." },
    denominatorKey: { type: "string", description: "Required for op ratio." },
    bands: {
      type: "array",
      description: "Required for op range_from_band: a [low, high] pair per sourced band name.",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          low: { type: "number" },
          high: { type: "number" },
        },
        required: ["name", "low", "high"],
      },
    },
  },
  required: ["op", "unit", "sectionTitle", "headlineLabel", "mechanismTemplate", "inputs", "maxFactor", "resultCeiling"],
} as const;

export const STRATEGY_TOOL_SCHEMA = {
  type: "object",
  properties: {
    plan: {
      type: "object",
      properties: {
        domains: { type: "array", items: { type: "string" } },
        voiceTargeting: { type: "string" },
        inputSourcing: { type: "string" },
      },
      required: ["domains", "voiceTargeting", "inputSourcing"],
    },
    recipe: RECIPE_SCHEMA,
  },
  required: ["plan", "recipe"],
} as const;

export const STRATEGIST_SYSTEM_PROMPT = `You are the Mirenta strategist. Given one lead (a founder) and the seller's product, you plan how to win that founder's attention: what to research, which respected voices to hunt, and the single quantifying value the page will make. You do no research and write no page copy. You emit one compact Strategy through the emit_strategy tool.

# The research plan

Name the domains to organize the founder's priorities around, drawn from what this founder actually builds, not a fixed industry list. Write voice-targeting guidance for the self/backer/tribe ladder tuned to this founder's world. Write input-sourcing guidance naming where the research agent finds each recipe input as a fact (posts, filings, launch pages, raise announcements).

# The metric recipe

Design ONE recipe that quantifies the value the seller's product creates for THIS founder. The recipe is a formula code runs deterministically; you never compute or write the number. Pick the operation that fits the value honestly:

- identity: pass one sourced input through, OR (unit qualitative) state a point of view with literalValue when no honest number exists. Prefer the qualitative path over a forced or fabricated figure.
- sum: add sourced costs or counts.
- multiply: a product of sourced inputs. Set maxFactor to a defensible ceiling, since an unbounded product is the classic overstated-ROI failure.
- ratio: a per-unit figure. Name numeratorKey and denominatorKey.
- range_from_band: map a sourced public band (for example a funding stage) to a [low, high] pair.

Rules that keep the figure honest:
- Every input carries a defensible [min, max] clamp. Set them to ranges a skeptical founder accepts.
- Set resultCeiling to the largest figure that stays credible for this founder's stage.
- Prefer a modest, defensible number over an impressive one. A founder trusts a figure they recognize and dismisses one that flatters.
- When no honest number exists, choose op identity, unit qualitative, and state the point of view in literalValue.

The mechanism sentence must read as one clean, grammatical sentence a founder believes. Write {result} where the final figure belongs (it already carries its unit, so add no unit word after it). Write {value.<key>} where a sourced number belongs, and {input.<key>} where the input's noun-phrase label belongs. Read your template back as if the tokens were filled: it must parse as plain English, never repeat a unit, and never drop a raw label into a slot that reads as a number. Example for a multiply recipe: "Mirenta returns {result} by automating the {value.pitches} pitches you send each week that each take {value.hours} hours by hand."

# Writing style

No contractions, active voice, present tense, strong verbs, no weak openers, no em dashes. Mechanism templates read as one plain sentence.

Call emit_strategy exactly once.`;

export function buildStrategistPrompt(input: StrategistInput): string {
  const leadName = `${input.lead.first_name} ${input.lead.last_name}`;
  const role = input.lead.role ? ` (${input.lead.role})` : "";
  const website = input.lead.website_url || "(no website provided; the research agent will search for it)";
  return `Plan the strategy for a one-pager targeting ${leadName}${role} at ${input.lead.company}.

Company website: ${website}
Seller: ${input.profile.company_name}
Product: ${input.profile.product_name} — ${input.profile.value_prop}

Decide the domains to research, the voices to hunt, the input-sourcing guidance, and the one metric recipe that quantifies this product's value for this founder honestly. Call emit_strategy exactly once.`;
}

export class StrategySchemaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StrategySchemaError";
  }
}

// Validate the strategist output into a typed Strategy. The recipe must carry
// every field its op needs, since the research agent and the evaluator both
// depend on a complete recipe; a gap throws here rather than surfacing later.
export function validateStrategy(raw: unknown): Strategy {
  if (typeof raw !== "object" || raw === null) {
    throw new StrategySchemaError("strategy is not an object");
  }
  const r = raw as Record<string, unknown>;
  const plan = r.plan as Record<string, unknown> | undefined;
  if (
    !plan ||
    !Array.isArray(plan.domains) ||
    !plan.domains.every((d) => typeof d === "string") ||
    plan.domains.length === 0 ||
    typeof plan.voiceTargeting !== "string" ||
    typeof plan.inputSourcing !== "string"
  ) {
    throw new StrategySchemaError("strategy.plan malformed");
  }

  const recipe = validateRecipeShape(r.recipe);

  return {
    plan: {
      domains: plan.domains as string[],
      voiceTargeting: plan.voiceTargeting,
      inputSourcing: plan.inputSourcing,
    },
    recipe,
  };
}

function validateRecipeShape(raw: unknown): MetricRecipe {
  if (typeof raw !== "object" || raw === null) {
    throw new StrategySchemaError("strategy.recipe is not an object");
  }
  const r = raw as Record<string, unknown>;
  if (!RECIPE_OPS.includes(r.op as MetricRecipe["op"])) {
    throw new StrategySchemaError(`strategy.recipe.op invalid: ${String(r.op)}`);
  }
  if (!RECIPE_UNITS.includes(r.unit as MetricRecipe["unit"])) {
    throw new StrategySchemaError(`strategy.recipe.unit invalid: ${String(r.unit)}`);
  }
  for (const field of ["sectionTitle", "headlineLabel", "mechanismTemplate"] as const) {
    if (typeof r[field] !== "string" || (r[field] as string).trim() === "") {
      throw new StrategySchemaError(`strategy.recipe.${field} required`);
    }
  }
  if (typeof r.maxFactor !== "number" || typeof r.resultCeiling !== "number") {
    throw new StrategySchemaError("strategy.recipe.maxFactor and resultCeiling required");
  }
  if (!Array.isArray(r.inputs)) {
    throw new StrategySchemaError("strategy.recipe.inputs must be an array");
  }
  const inputs = r.inputs.map((i, idx) => {
    const input = i as Record<string, unknown>;
    if (
      typeof input.key !== "string" ||
      typeof input.label !== "string" ||
      typeof input.min !== "number" ||
      typeof input.max !== "number"
    ) {
      throw new StrategySchemaError(`strategy.recipe.inputs[${idx}] malformed`);
    }
    return { key: input.key, label: input.label, min: input.min, max: input.max };
  });

  const op = r.op as MetricRecipe["op"];
  const unit = r.unit as MetricRecipe["unit"];
  const recipe: MetricRecipe = {
    op,
    unit,
    sectionTitle: r.sectionTitle as string,
    headlineLabel: r.headlineLabel as string,
    mechanismTemplate: r.mechanismTemplate as string,
    inputs,
    maxFactor: r.maxFactor,
    resultCeiling: r.resultCeiling,
  };

  // Per-op required fields, the no-fallback rule applied to the recipe shape.
  if (op === "identity" && unit === "qualitative") {
    if (typeof r.literalValue !== "string" || (r.literalValue as string).trim() === "") {
      throw new StrategySchemaError("qualitative recipe requires literalValue");
    }
    recipe.literalValue = r.literalValue as string;
  }
  if (op === "ratio") {
    if (typeof r.numeratorKey !== "string" || typeof r.denominatorKey !== "string") {
      throw new StrategySchemaError("ratio recipe requires numeratorKey and denominatorKey");
    }
    recipe.numeratorKey = r.numeratorKey;
    recipe.denominatorKey = r.denominatorKey;
  }
  if (op === "range_from_band") {
    if (!Array.isArray(r.bands) || r.bands.length === 0) {
      throw new StrategySchemaError("range_from_band recipe requires bands");
    }
    recipe.bands = r.bands.map((b, idx) => {
      const band = b as Record<string, unknown>;
      if (
        typeof band.name !== "string" ||
        typeof band.low !== "number" ||
        typeof band.high !== "number"
      ) {
        throw new StrategySchemaError(`strategy.recipe.bands[${idx}] malformed`);
      }
      return { name: band.name, low: band.low, high: band.high };
    });
  }

  return recipe;
}
