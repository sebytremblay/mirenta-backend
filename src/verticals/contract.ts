// Contract enforcement for the vertical seam. D38/D49 require a disclosure
// policy (exactly three scenarios named conservative/expected/aggressive, and a
// footnote when inputs are estimated). The ValueModel interface is deliberately
// flexible for future verticals, so enforcement happens at two points:
// 1. Development time: test helper (assertValueModelContract) fails when violated
// 2. Runtime: the builder calls validateDisclosurePolicy, which throws the typed
//    ValueModelContractError; the worker classifies that type as a permanent
//    stage failure (src/worker/tick.ts buildAndPublishStage), so a misconfigured
//    vertical fails loudly instead of retrying a deterministic breach.

import type { ValueResult } from "./types.ts";

export class ValueModelContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValueModelContractError";
  }
}

// The three scenario names the D38/D49 disclosure policy requires, in order. The
// single source of truth: the disclosure check on the rendered ValueResult and a
// vertical's save-time economics validation both read it, so the policy cannot
// drift between the two gates.
export const DISCLOSURE_SCENARIO_NAMES = ["Conservative", "Expected", "Aggressive"] as const;

// Validate D38/D49 disclosure policy: exactly 3 scenarios with specific names,
// and footnote when inputs are estimated. Throws ValueModelContractError when
// violated; the builder lets that typed error propagate and the worker
// classifies it as a permanent stage failure.
export function validateDisclosurePolicy(result: ValueResult, estimated: boolean): void {
  // Scenario count
  if (result.scenarios.length !== 3) {
    throw new ValueModelContractError(
      `D38/D49 requires exactly 3 scenarios, got ${result.scenarios.length}`,
    );
  }

  // Scenario names (order matters for D49)
  const names = result.scenarios.map((s) => s.name);
  const expected = [...DISCLOSURE_SCENARIO_NAMES];
  if (JSON.stringify(names) !== JSON.stringify(expected)) {
    throw new ValueModelContractError(
      `D49 requires scenario names ${JSON.stringify(expected)}, got ${JSON.stringify(names)}`,
    );
  }

  // Footnote disclosure when estimated
  if (estimated && !result.footnote) {
    throw new ValueModelContractError("D38 requires footnote when inputs are estimated");
  }
}

// Contract test helper for vertical test files. Validates the full contract
// (disclosure policy plus structural requirements) so tests catch violations
// before runtime. Use in every vertical's unit tests.
export function assertValueModelContract(result: ValueResult, estimated: boolean): void {
  validateDisclosurePolicy(result, estimated);

  // Additional structural assertions
  if (!result.sectionTitle || result.sectionTitle.trim() === "") {
    throw new ValueModelContractError("sectionTitle required");
  }

  if (!result.headline.label || !result.headline.value) {
    throw new ValueModelContractError("headline label and value required");
  }

  for (const [i, scenario] of result.scenarios.entries()) {
    if (!scenario.primaryValue || !scenario.primaryLabel) {
      throw new ValueModelContractError(
        `scenario[${i}] missing primaryValue or primaryLabel`,
      );
    }
  }
}
