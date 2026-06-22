// Contract enforcement for the vertical seam. D38/D49 require a disclosure
// policy (exactly three scenarios named conservative/expected/aggressive, and a
// footnote when inputs are estimated). The ValueModel interface is deliberately
// flexible for future verticals, so enforcement happens at two points:
// 1. Development time: test helper (assertValueModelContract) fails when violated
// 2. Runtime: the builder calls validateDisclosurePolicy, which throws the typed
//    ValueModelContractError; the worker classifies that type as a permanent
//    stage failure (src/worker/tick.ts buildAndPublishStage), so a misconfigured
//    vertical fails loudly instead of retrying a deterministic breach.

import type { ValueResult, VerticalEconomics } from "./types.ts";

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

// Shared save-time economics validation, factored out so every vertical enforces
// the same shape and the same D38/D49 disclosure policy from one source. A
// vertical passes the effectiveness keys its compute reads (requiredEffectivenessKeys)
// so a typo'd or missing key fails at save rather than computing a silent zero for
// that term. Throws ValueModelContractError on any violation; saveProfile maps the
// throw to a 400, and createValueModel calls it again at build as defense in depth.
// The error message wording is load-bearing: saveProfile surfaces it to the seller
// and the personalization tests match on it, so keep the phrasing stable.
export function validateEconomicsShape(
  raw: unknown,
  requiredEffectivenessKeys: readonly string[],
): VerticalEconomics {
  if (typeof raw !== "object" || raw === null) {
    throw new ValueModelContractError("economics must be an object");
  }
  const e = raw as Record<string, unknown>;

  if (typeof e.annual_license !== "number" || e.annual_license < 0) {
    throw new ValueModelContractError("economics.annual_license must be a non-negative number");
  }
  if (typeof e.implementation_fee !== "number" || e.implementation_fee < 0) {
    throw new ValueModelContractError("economics.implementation_fee must be a non-negative number");
  }
  // Optional per-seat annual price. When present it must be a non-negative number;
  // a vertical whose value applies org-wide regardless of headcount omits it.
  if (e.price_per_seat_year !== undefined) {
    if (typeof e.price_per_seat_year !== "number" || e.price_per_seat_year < 0) {
      throw new ValueModelContractError(
        "economics.price_per_seat_year must be a non-negative number",
      );
    }
  }
  if (!Array.isArray(e.scenarios) || e.scenarios.length !== 3) {
    throw new ValueModelContractError(
      "economics.scenarios must be an array of exactly 3 scenarios",
    );
  }
  for (const [i, s] of e.scenarios.entries()) {
    if (typeof s !== "object" || s === null) {
      throw new ValueModelContractError(`economics.scenarios[${i}] must be an object`);
    }
    const scenario = s as Record<string, unknown>;
    // D49: names must match the disclosure policy exactly and in order, since the
    // value model passes them straight onto the rendered scenario cards.
    const expectedName = DISCLOSURE_SCENARIO_NAMES[i];
    if (scenario.name !== expectedName) {
      throw new ValueModelContractError(
        `economics.scenarios[${i}].name must be "${expectedName}" (D49 disclosure policy), got ${JSON.stringify(scenario.name)}`,
      );
    }
    if (typeof scenario.effectiveness !== "object" || scenario.effectiveness === null) {
      throw new ValueModelContractError(
        `economics.scenarios[${i}].effectiveness must be an object`,
      );
    }
    const effectiveness = scenario.effectiveness as Record<string, unknown>;
    // Every key compute reads must be present and numeric, so no term silently
    // defaults to zero from a missing or misspelled key.
    for (const key of requiredEffectivenessKeys) {
      if (typeof effectiveness[key] !== "number") {
        throw new ValueModelContractError(
          `economics.scenarios[${i}].effectiveness.${key} must be a number`,
        );
      }
    }
  }

  if (e.adoption_curve !== undefined) {
    if (!Array.isArray(e.adoption_curve) || e.adoption_curve.some((n) => typeof n !== "number")) {
      throw new ValueModelContractError("economics.adoption_curve must be an array of numbers");
    }
  }

  return e as unknown as VerticalEconomics;
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
