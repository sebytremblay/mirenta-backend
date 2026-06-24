import type { ValueResult } from "./types.ts";

export class ValueModelContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValueModelContractError";
  }
}

// The founder disclosure contract. It validates the render shape and the
// no-fabrication invariant only: a non-empty sectionTitle, a headline carrying
// both label and value, a non-empty mechanism, and a footnote whenever inputs
// are estimated. It inspects neither the value unit (a free string the vertical
// owns) nor the economics fields (opaque to the engine per the founder
// redesign). Each vertical's own validateEconomics enforces its economics shape.
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

  if (estimated && !result.footnote) {
    throw new ValueModelContractError(
      "disclosure policy requires a footnote when inputs are estimated",
    );
  }
}
