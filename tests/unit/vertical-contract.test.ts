import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateDisclosurePolicy,
  assertValueModelContract,
  ValueModelContractError,
} from "../../src/verticals/contract.ts";
import type { ValueResult } from "../../src/verticals/types.ts";

function compliantResult(estimated: boolean): ValueResult {
  return {
    sectionTitle: "Business Value",
    headline: { label: "Expected net annual savings", value: "$1.5M" },
    scenarios: [
      { name: "Conservative", primaryValue: "$1M", primaryLabel: "Net Annual Savings" },
      { name: "Expected", primaryValue: "$1.5M", primaryLabel: "Net Annual Savings" },
      { name: "Aggressive", primaryValue: "$2M", primaryLabel: "Net Annual Savings" },
    ],
    footnote: estimated ? "Staff counts estimated from industry benchmarks." : undefined,
  };
}

test("validateDisclosurePolicy passes for a compliant result", () => {
  const result = compliantResult(true);
  validateDisclosurePolicy(result, true);
});

test("validateDisclosurePolicy throws when scenario count is wrong", () => {
  const result = compliantResult(true);
  result.scenarios = result.scenarios.slice(0, 2);

  assert.throws(() => validateDisclosurePolicy(result, true), (err: unknown) => {
    return err instanceof ValueModelContractError && /exactly 3 scenarios/.test(err.message);
  });
});

test("validateDisclosurePolicy throws when scenario names are wrong", () => {
  const result = compliantResult(true);
  result.scenarios[0]!.name = "Low";

  assert.throws(() => validateDisclosurePolicy(result, true), (err: unknown) => {
    return (
      err instanceof ValueModelContractError &&
      /Conservative.*Expected.*Aggressive/.test(err.message)
    );
  });
});

test("validateDisclosurePolicy throws when scenario order is wrong", () => {
  const result = compliantResult(true);
  [result.scenarios[0], result.scenarios[1]] = [result.scenarios[1]!, result.scenarios[0]!];

  assert.throws(() => validateDisclosurePolicy(result, true), (err: unknown) => {
    return (
      err instanceof ValueModelContractError &&
      /Conservative.*Expected.*Aggressive/.test(err.message)
    );
  });
});

test("validateDisclosurePolicy throws when footnote is missing and estimated=true", () => {
  const result = compliantResult(true);
  result.footnote = undefined;

  assert.throws(() => validateDisclosurePolicy(result, true), (err: unknown) => {
    return err instanceof ValueModelContractError && /requires a footnote/.test(err.message);
  });
});

test("validateDisclosurePolicy passes when footnote is absent and estimated=false", () => {
  const result = compliantResult(false);
  validateDisclosurePolicy(result, false);
});

test("assertValueModelContract validates full structural requirements", () => {
  const result = compliantResult(true);
  assertValueModelContract(result, true);
});

test("assertValueModelContract throws when sectionTitle is missing", () => {
  const result = compliantResult(true);
  result.sectionTitle = "";

  assert.throws(() => assertValueModelContract(result, true), (err: unknown) => {
    return err instanceof ValueModelContractError && /sectionTitle required/.test(err.message);
  });
});

test("assertValueModelContract throws when headline label is missing", () => {
  const result = compliantResult(true);
  result.headline.label = "";

  assert.throws(() => assertValueModelContract(result, true), (err: unknown) => {
    return (
      err instanceof ValueModelContractError &&
      /headline label and value required/.test(err.message)
    );
  });
});

test("assertValueModelContract throws when scenario primaryValue is missing", () => {
  const result = compliantResult(true);
  result.scenarios[1]!.primaryValue = "";

  assert.throws(() => assertValueModelContract(result, true), (err: unknown) => {
    return err instanceof ValueModelContractError && /scenario\[1\] missing/.test(err.message);
  });
});

test("assertValueModelContract throws when scenario primaryLabel is missing", () => {
  const result = compliantResult(true);
  result.scenarios[2]!.primaryLabel = "";

  assert.throws(() => assertValueModelContract(result, true), (err: unknown) => {
    return err instanceof ValueModelContractError && /scenario\[2\] missing/.test(err.message);
  });
});
