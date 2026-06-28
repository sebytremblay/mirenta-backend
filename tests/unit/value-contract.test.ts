import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assertValueModelContract,
  ValueModelContractError,
  type ValueResult,
} from "../../src/domain/value-contract.ts";

function compliantResult(estimated: boolean): ValueResult {
  return {
    sectionTitle: "What this frees up",
    headline: { label: "Founder time reclaimed", value: "~4 to 6 hours each week" },
    mechanism: "A seed-stage founder runs go-to-market by hand.",
    breakdown: [{ label: "weekly hours", value: "5", estimated }],
    footnote: estimated ? "Drawn from inferred signals." : undefined,
  };
}

test("assertValueModelContract accepts a value-expression-plus-mechanism result when estimated", () => {
  assertValueModelContract(compliantResult(true), true);
});

test("assertValueModelContract accepts a value-expression-plus-mechanism result when not estimated", () => {
  assertValueModelContract(compliantResult(false), false);
});

test("assertValueModelContract throws when sectionTitle is empty", () => {
  const result = compliantResult(true);
  result.sectionTitle = "";
  assert.throws(() => assertValueModelContract(result, true), (err: unknown) => {
    return err instanceof ValueModelContractError && /sectionTitle required/.test(err.message);
  });
});

test("assertValueModelContract throws when headline label is empty", () => {
  const result = compliantResult(true);
  result.headline.label = "";
  assert.throws(() => assertValueModelContract(result, true), (err: unknown) => {
    return err instanceof ValueModelContractError && /headline label and value required/.test(err.message);
  });
});

test("assertValueModelContract throws when headline value is empty", () => {
  const result = compliantResult(true);
  result.headline.value = "";
  assert.throws(() => assertValueModelContract(result, true), (err: unknown) => {
    return err instanceof ValueModelContractError && /headline label and value required/.test(err.message);
  });
});

test("assertValueModelContract throws when mechanism is empty", () => {
  const result = compliantResult(true);
  result.mechanism = "";
  assert.throws(() => assertValueModelContract(result, true), (err: unknown) => {
    return err instanceof ValueModelContractError && /mechanism required/.test(err.message);
  });
});

test("assertValueModelContract throws when breakdown is not an array", () => {
  const result = compliantResult(true);
  (result as { breakdown: unknown }).breakdown = undefined;
  assert.throws(() => assertValueModelContract(result, true), (err: unknown) => {
    return err instanceof ValueModelContractError && /breakdown required/.test(err.message);
  });
});

test("assertValueModelContract accepts an empty breakdown for a qualitative value", () => {
  const result = compliantResult(false);
  result.breakdown = [];
  result.headline.value = "a hire you do not make this year";
  assertValueModelContract(result, false);
});

test("assertValueModelContract throws when footnote is missing and estimated=true", () => {
  const result = compliantResult(true);
  result.footnote = undefined;
  assert.throws(() => assertValueModelContract(result, true), (err: unknown) => {
    return err instanceof ValueModelContractError && /footnote/.test(err.message);
  });
});

test("assertValueModelContract passes when footnote is absent and estimated=false", () => {
  assertValueModelContract(compliantResult(false), false);
});

test("the contract inspects neither unit nor internals, so a qualitative value passes", () => {
  const result = compliantResult(false);
  result.headline.value = "a hire you do not make this year";
  assertValueModelContract(result, false);
});
