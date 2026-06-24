import { test } from "node:test";
import assert from "node:assert/strict";
import { employeeServiceVertical } from "../../src/verticals/employee-service.ts";
import { ValueModelContractError } from "../../src/verticals/contract.ts";
import type { VerticalEconomics } from "../../src/verticals/types.ts";
import { makeProfile } from "../fixtures/profile.ts";

const baseProfile = makeProfile();

test("createValueModel returns a bound value model with economics", () => {
  const valueModel = employeeServiceVertical.createValueModel(baseProfile);

  assert.ok(valueModel.economics, "economics should be present");
  assert.equal(typeof valueModel.economics.savings_basis_points, "number");
});

test("factory returns default economics when profile.economics is absent", () => {
  const defaultEcon = employeeServiceVertical.defaultEconomics();
  const valueModel = employeeServiceVertical.createValueModel(baseProfile);

  assert.equal(valueModel.economics.savings_basis_points, defaultEcon.savings_basis_points);
  assert.equal(valueModel.economics.savings_basis_points, 35);
});

test("compute reads economics from the factory closure", () => {
  const valueModel = employeeServiceVertical.createValueModel(
    makeProfile({ economics: { savings_basis_points: 50 } }),
  );
  const inputs = valueModel.validateInputs({ total_employees: 10000 }, false);
  const result = valueModel.compute(inputs);

  // Compute renders the basis-point rate from the closure, not a hardcoded value.
  assert.ok(result.headline.value.includes("50 basis points"));

  const defaultModel = employeeServiceVertical.createValueModel(baseProfile);
  const defaultResult = defaultModel.compute(
    defaultModel.validateInputs({ total_employees: 10000 }, false),
  );
  assert.notEqual(result.headline.value, defaultResult.headline.value);
});

test("validateInputs works independently of economics", () => {
  const validated = employeeServiceVertical.validateInputs({ total_employees: 5000 }, true);

  assert.equal(validated.values.total_employees, 5000);
  assert.equal(validated.estimated, true);
});

// validateInputs and inputGuidance gate at two points (the spec copy in
// validateResearch, the bound-model copy in buildSite). They must stay the same
// objects by identity, or a payload could pass one gate and fail the other.
test("bound model reuses the spec's validateInputs and inputGuidance (no drift)", () => {
  const valueModel = employeeServiceVertical.createValueModel(baseProfile);

  assert.equal(
    valueModel.validateInputs,
    employeeServiceVertical.validateInputs,
    "bound model validateInputs must be the same function as the spec's",
  );
  assert.equal(
    valueModel.inputGuidance,
    employeeServiceVertical.inputGuidance,
    "bound model inputGuidance must be the same string as the spec's",
  );
});

const customEconomics: VerticalEconomics = { savings_basis_points: 50 };

test("factory reads profile.economics when present", () => {
  const profile = makeProfile({ economics: customEconomics });
  const valueModel = employeeServiceVertical.createValueModel(profile);

  assert.equal(valueModel.economics.savings_basis_points, 50);
});

test("compute uses custom economics, not the defaults", () => {
  const custom = employeeServiceVertical.createValueModel(
    makeProfile({ economics: customEconomics }),
  );
  const def = employeeServiceVertical.createValueModel(makeProfile());

  const inputs = { total_employees: 20000 };
  const customResult = custom.compute(custom.validateInputs(inputs, false));
  const defResult = def.compute(def.validateInputs(inputs, false));

  assert.notEqual(customResult.headline.value, defResult.headline.value);
});

test("factory rejects a malformed economics object", () => {
  const profile = makeProfile({ economics: {} });

  assert.throws(
    () => employeeServiceVertical.createValueModel(profile),
    (err: unknown) =>
      err instanceof ValueModelContractError && /savings_basis_points/.test(err.message),
  );
});

test("validateEconomics accepts a well-formed economics object", () => {
  const result = employeeServiceVertical.validateEconomics(customEconomics);
  assert.equal(result.savings_basis_points, 50);
});

test("validateEconomics rejects a missing savings_basis_points", () => {
  assert.throws(
    () => employeeServiceVertical.validateEconomics({}),
    (err: unknown) =>
      err instanceof ValueModelContractError && /savings_basis_points/.test(err.message),
  );
});

test("validateEconomics rejects a non-positive savings_basis_points", () => {
  assert.throws(
    () => employeeServiceVertical.validateEconomics({ savings_basis_points: 0 }),
    (err: unknown) =>
      err instanceof ValueModelContractError && /savings_basis_points/.test(err.message),
  );
});
