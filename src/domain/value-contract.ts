// The founder value render and its disclosure contract. The recipe evaluator
// (recipe.ts) produces a ValueResult; assertValueModelContract validates the
// render shape and the no-fabrication disclosure invariant before the builder
// renders it. The contract inspects neither the value unit (a free display
// string the recipe owns) nor the recipe internals; it enforces only that a
// render carries a title, a headline label and value, a mechanism, and a
// footnote whenever the inputs behind the figure were estimated.

// One sourced number behind the figure, surfaced so the builder can render an
// honest visual breakdown that reconciles to the headline. `value` is the
// clamped number the formula used, formatted plainly; `estimated` flags whether
// the research sourced it or inferred it.
export interface ValueBreakdownItem {
  label: string;
  value: string;
  estimated: boolean;
}

// One honest expression plus the one-sentence mechanism that produces it,
// footnoted as estimated when the inputs are inferred. `headline.value` is a
// display string the evaluator composes (a currency figure, an hours range, a
// percent, or a qualitative claim); the builder renders it verbatim and never
// parses it. `breakdown` lists every sourced number behind the figure so the
// builder visualizes the real inputs rather than inventing data.
export interface ValueResult {
  sectionTitle: string;
  headline: { label: string; value: string };
  mechanism: string; // the one-sentence "why", required
  breakdown: ValueBreakdownItem[]; // the sourced numbers behind the figure, empty for a bandless qualitative or band recipe
  footnote?: string; // estimated disclosure
}

export class ValueModelContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValueModelContractError";
  }
}

export function assertValueModelContract(result: ValueResult, estimated: boolean): void {
  if (!result.sectionTitle || result.sectionTitle.trim() === "") {
    throw new ValueModelContractError("sectionTitle required");
  }

  if (!result.headline || !result.headline.label || !result.headline.value) {
    throw new ValueModelContractError("headline label and value required");
  }

  if (!result.mechanism || result.mechanism.trim() === "") {
    throw new ValueModelContractError("mechanism required");
  }

  if (!Array.isArray(result.breakdown)) {
    throw new ValueModelContractError("breakdown required");
  }

  if (estimated && !result.footnote) {
    throw new ValueModelContractError(
      "disclosure policy requires a footnote when inputs are estimated",
    );
  }
}
