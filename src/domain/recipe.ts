// The metric recipe: how the one-pager's quantifying value gets produced without
// an LLM ever doing arithmetic or writing the displayed number.
//
// The strategist (Opus) plans a recipe: a closed-set operation over named inputs,
// each input bounded, the whole result capped. The research agent (Haiku) sources
// each named input as a fact and marks it sourced or estimated. evaluateRecipe
// then runs the formula deterministically and formats the display string. This
// preserves the no-fabrication invariant the old per-vertical value models held,
// generalized to any metric, and guards the prior overstated-ROI failure (a model
// multiplied a full rep roster by full baseline meetings) with required clamps,
// a multiply ceiling, and an absolute result cap.

import type { ValueResult, ValueBreakdownItem } from "./value-contract.ts";

// A closed operation set, each chosen for the failure it prevents:
// - identity: pass one input through, or render a literal qualitative claim. The
//   generic, number-free case lives here, so there is one path, not a branch.
// - sum: add inputs.
// - multiply: product of inputs, each clamped, product bounded by maxFactor. This
//   is the operation behind the overstated-ROI bug, so it carries the hardest guard.
// - ratio: numerator over a required denominator. Guards divide-by-zero and the
//   "multiply everything" inflation by forcing a per-unit framing.
// - range_from_band: map a sourced categorical band to a [low, high] pair. The
//   generalization of the old band_hours lookup.
export type RecipeOp = "identity" | "sum" | "multiply" | "ratio" | "range_from_band";

// The unit of the RESULT, which drives deterministic formatting of the display
// string. The LLM never writes the number; the formatter does, from this unit.
export type RecipeUnit = "currency_usd" | "hours_per_week" | "percent" | "count" | "qualitative";

export const RECIPE_OPS: readonly RecipeOp[] = [
  "identity",
  "sum",
  "multiply",
  "ratio",
  "range_from_band",
];

export const RECIPE_UNITS: readonly RecipeUnit[] = [
  "currency_usd",
  "hours_per_week",
  "percent",
  "count",
  "qualitative",
];

// A named input the recipe references. min and max are required (no optional
// default), so every numeric input is bounded before it enters the formula.
export interface RecipeInput {
  key: string; // the formula references this key
  label: string; // human label, used to fill the mechanism sentence
  min: number; // clamp floor, required
  max: number; // clamp ceiling, required
}

// A band entry for range_from_band: a sourced band name mapped to its [low, high]
// pair. The research agent sources which band applies; the pair is planned, not
// generated, so the rendered range is never fabricated.
export interface RecipeBand {
  name: string;
  low: number;
  high: number;
}

export interface MetricRecipe {
  op: RecipeOp;
  unit: RecipeUnit; // unit of the result, drives formatting
  sectionTitle: string;
  headlineLabel: string;
  // The mechanism sentence with {result} and {input.<key>} tokens the evaluator
  // fills from labels and the formatted result. One required sentence, never
  // generated at render time.
  mechanismTemplate: string;
  // The numeric inputs the formula reads. Empty only for the qualitative identity
  // case (op "identity", unit "qualitative"), which renders literalValue instead.
  inputs: RecipeInput[];
  // Required ceiling on a multiply product, the guard against roster x meetings.
  // Ignored by non-multiply ops but always present so the schema has one shape.
  maxFactor: number;
  // Required absolute cap on the computed result, the backstop against any
  // inflated figure slipping through per-input clamps.
  resultCeiling: number;
  // The qualitative literal for op "identity" + unit "qualitative". Required for
  // that case, absent otherwise. This keeps the qualitative path inside the same
  // schema rather than a separate branch.
  literalValue?: string;
  // The numerator input key for op "ratio". Required for ratio, absent otherwise.
  numeratorKey?: string;
  // The denominator input key for op "ratio". Required for ratio; a ratio without
  // a denominator throws rather than dividing by an implicit one.
  denominatorKey?: string;
  // The band table for op "range_from_band". Required for that op, absent otherwise.
  bands?: RecipeBand[];
}

// A sourced input value the research agent produced: the number it found plus
// whether it sourced the fact or estimated it. The result-level estimated flag is
// the OR of these, so a single estimated input forces the disclosure footnote.
export interface SourcedInput {
  value: number;
  estimated: boolean;
}

// The sourced inputs keyed by RecipeInput.key, plus the band name for a
// range_from_band recipe. band is required for that op and ignored otherwise.
export interface RecipeInputs {
  values: Record<string, SourcedInput>;
  band?: { name: string; estimated: boolean };
}

export class RecipeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RecipeError";
  }
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

// Resolve one declared input to its clamped sourced value, or throw. A missing
// or non-finite input throws rather than defaulting, per the no-fallback rule.
function resolveInput(
  recipe: MetricRecipe,
  inputs: RecipeInputs,
  key: string,
): { value: number; estimated: boolean } {
  const declared = recipe.inputs.find((i) => i.key === key);
  if (!declared) {
    throw new RecipeError(`recipe references undeclared input: ${key}`);
  }
  const sourced = inputs.values[key];
  if (!sourced) {
    throw new RecipeError(`recipe input not sourced: ${key}`);
  }
  if (typeof sourced.value !== "number" || !Number.isFinite(sourced.value)) {
    throw new RecipeError(`recipe input ${key} is not a finite number`);
  }
  if (declared.min > declared.max) {
    throw new RecipeError(`recipe input ${key} has min greater than max`);
  }
  return { value: clamp(sourced.value, declared.min, declared.max), estimated: sourced.estimated };
}

interface Computed {
  // For a single scalar result. For a range result, low and high differ.
  low: number;
  high: number;
  estimated: boolean;
  // The clamped sourced value of every declared input, keyed by input key. The
  // mechanism sentence fills {value.<key>} from this, so the displayed sentence
  // grounds in the real number rather than the input's descriptive label.
  clampedValues: Record<string, number>;
}

function computeOp(recipe: MetricRecipe, inputs: RecipeInputs): Computed {
  // Resolve every declared input once and keep the clamped values, so the
  // mechanism sentence can name the real number behind each input.
  const clampedValues: Record<string, number> = {};
  for (const input of recipe.inputs) {
    clampedValues[input.key] = resolveInput(recipe, inputs, input.key).value;
  }

  switch (recipe.op) {
    case "identity": {
      // Qualitative identity carries no numeric result; the caller renders the
      // literal. A numeric identity passes one declared input through.
      if (recipe.unit === "qualitative") {
        return { low: 0, high: 0, estimated: inputs.band?.estimated ?? false, clampedValues };
      }
      const only = recipe.inputs[0];
      if (!only) throw new RecipeError("identity recipe declares no input");
      const r = resolveInput(recipe, inputs, only.key);
      return { low: r.value, high: r.value, estimated: r.estimated, clampedValues };
    }
    case "sum": {
      if (recipe.inputs.length === 0) throw new RecipeError("sum recipe declares no inputs");
      let total = 0;
      let estimated = false;
      for (const input of recipe.inputs) {
        const r = resolveInput(recipe, inputs, input.key);
        total += r.value;
        estimated = estimated || r.estimated;
      }
      return { low: total, high: total, estimated, clampedValues };
    }
    case "multiply": {
      if (recipe.inputs.length === 0) throw new RecipeError("multiply recipe declares no inputs");
      let product = 1;
      let estimated = false;
      for (const input of recipe.inputs) {
        const r = resolveInput(recipe, inputs, input.key);
        product *= r.value;
        estimated = estimated || r.estimated;
      }
      // The multiply guard: the product of clamped inputs must not exceed the
      // planned ceiling. A recipe that tries to multiply a full roster by a full
      // baseline trips this rather than rendering an absurd figure.
      if (product > recipe.maxFactor) {
        throw new RecipeError(
          `multiply product ${product} exceeds maxFactor ${recipe.maxFactor}`,
        );
      }
      return { low: product, high: product, estimated, clampedValues };
    }
    case "ratio": {
      if (!recipe.numeratorKey || !recipe.denominatorKey) {
        throw new RecipeError("ratio recipe requires numeratorKey and denominatorKey");
      }
      const num = resolveInput(recipe, inputs, recipe.numeratorKey);
      const den = resolveInput(recipe, inputs, recipe.denominatorKey);
      if (den.value === 0) {
        throw new RecipeError("ratio denominator is zero");
      }
      return {
        low: num.value / den.value,
        high: num.value / den.value,
        estimated: num.estimated || den.estimated,
        clampedValues,
      };
    }
    case "range_from_band": {
      if (!recipe.bands || recipe.bands.length === 0) {
        throw new RecipeError("range_from_band recipe declares no bands");
      }
      if (!inputs.band) {
        throw new RecipeError("range_from_band recipe needs a sourced band");
      }
      const band = recipe.bands.find((b) => b.name === inputs.band!.name);
      if (!band) {
        throw new RecipeError(`sourced band not in recipe bands: ${inputs.band.name}`);
      }
      if (!Number.isFinite(band.low) || !Number.isFinite(band.high) || band.low > band.high) {
        throw new RecipeError(`recipe band ${band.name} has a malformed [low, high] pair`);
      }
      return { low: band.low, high: band.high, estimated: inputs.band.estimated, clampedValues };
    }
    default: {
      // Exhaustiveness guard. An unknown op throws rather than rendering nothing.
      const never: never = recipe.op;
      throw new RecipeError(`unknown recipe op: ${String(never)}`);
    }
  }
}

const CURRENCY = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

// Format the display string deterministically from the unit and the computed
// numbers. The LLM never writes this string. A range (low != high) renders as a
// "low to high" span; a scalar renders as a single figure.
function formatValue(recipe: MetricRecipe, c: Computed): string {
  if (recipe.unit === "qualitative") {
    const literal = recipe.literalValue;
    if (!literal || literal.trim() === "") {
      throw new RecipeError("qualitative recipe requires a literalValue");
    }
    return literal;
  }
  const isRange = c.low !== c.high;
  switch (recipe.unit) {
    case "currency_usd":
      return isRange
        ? `$${CURRENCY.format(c.low)} to $${CURRENCY.format(c.high)} per year`
        : `$${CURRENCY.format(c.low)} per year`;
    case "hours_per_week":
      return isRange
        ? `~${CURRENCY.format(c.low)} to ${CURRENCY.format(c.high)} hours each week`
        : `~${CURRENCY.format(c.low)} hours each week`;
    case "percent":
      return isRange
        ? `${CURRENCY.format(c.low)}% to ${CURRENCY.format(c.high)}%`
        : `${CURRENCY.format(c.low)}%`;
    case "count":
      return isRange
        ? `${CURRENCY.format(c.low)} to ${CURRENCY.format(c.high)}`
        : `${CURRENCY.format(c.low)}`;
    default: {
      const never: never = recipe.unit;
      throw new RecipeError(`unknown recipe unit: ${String(never)}`);
    }
  }
}

// A plain formatter for the per-input {value.<key>} token, so the mechanism
// sentence names the real sourced number ("14 prospects") rather than leaking
// the input's descriptive label into a slot that reads as a number. It keeps up
// to two fraction digits so a sub-1 factor (a 0.7 automation rate) renders as
// "0.7" rather than rounding to "1" and breaking the visible arithmetic.
const PLAIN = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

function fillMechanism(recipe: MetricRecipe, formattedValue: string, computed: Computed): string {
  let out = recipe.mechanismTemplate.replace(/\{result\}/g, formattedValue);
  for (const input of recipe.inputs) {
    // {value.<key>} fills with the clamped sourced number; {input.<key>} fills
    // with the human label. A template that wants the number uses value, one that
    // wants the descriptor uses input, so neither slot reads as the wrong kind.
    const clamped = computed.clampedValues[input.key];
    if (clamped !== undefined) {
      out = out.replace(new RegExp(`\\{value\\.${input.key}\\}`, "g"), PLAIN.format(clamped));
    }
    out = out.replace(new RegExp(`\\{input\\.${input.key}\\}`, "g"), input.label);
  }
  return out;
}

// The sourced numbers behind the figure, one per declared input, formatted
// plainly with each input's estimated flag. The builder renders this as an
// honest visual that reconciles to the headline, so the figure reads earned
// rather than asserted. A qualitative recipe and a bandless band recipe declare
// no numeric inputs, so the breakdown is empty for those.
function buildBreakdown(
  recipe: MetricRecipe,
  inputs: RecipeInputs,
  computed: Computed,
): ValueBreakdownItem[] {
  return recipe.inputs.map((input) => {
    const clamped = computed.clampedValues[input.key];
    const sourced = inputs.values[input.key];
    return {
      label: input.label,
      value: PLAIN.format(clamped ?? 0),
      estimated: sourced?.estimated === true,
    };
  });
}

// Evaluate a recipe against its sourced inputs to the founder value render. Every
// failure throws a RecipeError; the worker treats that as a permanent stage error
// (a malformed recipe never succeeds on retry). The returned estimated flag is the
// OR of every input's estimated flag, so the disclosure footnote fires whenever
// any figure behind the value was inferred rather than sourced.
export function evaluateRecipe(recipe: MetricRecipe, inputs: RecipeInputs): ValueResult {
  if (!RECIPE_OPS.includes(recipe.op)) {
    throw new RecipeError(`unknown recipe op: ${recipe.op}`);
  }
  if (!RECIPE_UNITS.includes(recipe.unit)) {
    throw new RecipeError(`unknown recipe unit: ${recipe.unit}`);
  }
  if (!recipe.sectionTitle?.trim() || !recipe.headlineLabel?.trim() || !recipe.mechanismTemplate?.trim()) {
    throw new RecipeError("recipe requires sectionTitle, headlineLabel, and mechanismTemplate");
  }

  const computed = computeOp(recipe, inputs);

  // The absolute result ceiling, the backstop after per-input clamps and the
  // multiply maxFactor. A qualitative recipe carries no numeric result, so the
  // ceiling does not apply to it.
  if (recipe.unit !== "qualitative") {
    if (!Number.isFinite(computed.low) || !Number.isFinite(computed.high)) {
      throw new RecipeError("recipe produced a non-finite result");
    }
    if (computed.high > recipe.resultCeiling) {
      throw new RecipeError(
        `recipe result ${computed.high} exceeds resultCeiling ${recipe.resultCeiling}`,
      );
    }
  }

  const value = formatValue(recipe, computed);
  const mechanism = fillMechanism(recipe, value, computed);
  const breakdown = buildBreakdown(recipe, inputs, computed);

  return {
    sectionTitle: recipe.sectionTitle,
    headline: { label: recipe.headlineLabel, value },
    mechanism,
    breakdown,
    footnote: computed.estimated
      ? "This figure draws on values inferred from public signals rather than the founder's own measured numbers, and serves as illustration pending a conversation."
      : undefined,
  };
}
