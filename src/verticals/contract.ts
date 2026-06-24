import type { ValueResult, VerticalEconomics } from "./types.ts";

export class ValueModelContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValueModelContractError";
  }
}

export const DISCLOSURE_SCENARIO_NAMES = ["Conservative", "Expected", "Aggressive"] as const;

export function validateDisclosurePolicy(result: ValueResult, estimated: boolean): void {
  if (result.scenarios.length !== 3) {
    throw new ValueModelContractError(
      `disclosure policy requires exactly 3 scenarios, got ${result.scenarios.length}`,
    );
  }

  const names = result.scenarios.map((s) => s.name);
  const expected = [...DISCLOSURE_SCENARIO_NAMES];
  if (JSON.stringify(names) !== JSON.stringify(expected)) {
    throw new ValueModelContractError(
      `disclosure policy requires scenario names ${JSON.stringify(expected)}, got ${JSON.stringify(names)}`,
    );
  }

  if (estimated && !result.footnote) {
    throw new ValueModelContractError("disclosure policy requires a footnote when inputs are estimated");
  }
}

// The error message wording is load-bearing: saveProfile surfaces it to the
// seller and the personalization tests match on it, so keep the phrasing stable.
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
    const expectedName = DISCLOSURE_SCENARIO_NAMES[i];
    if (scenario.name !== expectedName) {
      throw new ValueModelContractError(
        `economics.scenarios[${i}].name must be "${expectedName}" (disclosure policy), got ${JSON.stringify(scenario.name)}`,
      );
    }
    if (typeof scenario.effectiveness !== "object" || scenario.effectiveness === null) {
      throw new ValueModelContractError(
        `economics.scenarios[${i}].effectiveness must be an object`,
      );
    }
    const effectiveness = scenario.effectiveness as Record<string, unknown>;
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

export function assertValueModelContract(result: ValueResult, estimated: boolean): void {
  validateDisclosurePolicy(result, estimated);

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
