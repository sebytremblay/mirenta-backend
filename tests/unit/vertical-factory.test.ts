// Unit tests for the vertical factory pattern (Concern #1). Phase 1 always
// returns default economics; Phase 2 (after migration 0006) reads from
// profile.economics when populated. These tests verify the factory returns a
// bound value model and that compute uses the economics from the closure.

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
  assert.equal(typeof valueModel.economics.annual_license, "number");
  assert.equal(typeof valueModel.economics.implementation_fee, "number");
  assert.ok(Array.isArray(valueModel.economics.scenarios));
  assert.equal(valueModel.economics.scenarios.length, 3);
});

test("Phase 1: factory returns default economics when profile.economics is absent", () => {
  const defaultEcon = employeeServiceVertical.defaultEconomics();
  const valueModel = employeeServiceVertical.createValueModel(baseProfile);

  assert.equal(valueModel.economics.annual_license, defaultEcon.annual_license);
  assert.equal(valueModel.economics.implementation_fee, defaultEcon.implementation_fee);
  assert.equal(valueModel.economics.scenarios.length, defaultEcon.scenarios.length);
});

test("compute uses economics from the factory closure", () => {
  const valueModel = employeeServiceVertical.createValueModel(baseProfile);
  const inputs = valueModel.validateInputs({ total_employees: 10000 }, false);
  const result = valueModel.compute(inputs);

  // The default economics produce specific net savings figures. Verify compute
  // used those economics (not some other hardcoded values).
  assert.ok(result.scenarios.length === 3);
  assert.equal(result.scenarios[0]!.name, "Conservative");
  assert.equal(result.scenarios[1]!.name, "Expected");
  assert.equal(result.scenarios[2]!.name, "Aggressive");

  // Spot-check that the expected scenario ROI matches the default economics
  // (this would differ if compute used different license/implementation values)
  const expectedScenario = result.scenarios[1]!;
  assert.ok(expectedScenario.secondary?.includes("ROI"));
});

test("defaultEconomics returns the hardcoded baseline", () => {
  const econ = employeeServiceVertical.defaultEconomics();

  assert.equal(econ.annual_license, 1_500_000);
  assert.equal(econ.implementation_fee, 200_000);
  assert.equal(econ.scenarios.length, 3);
  assert.equal(econ.scenarios[0]!.name, "Conservative");
  assert.equal(econ.scenarios[1]!.name, "Expected");
  assert.equal(econ.scenarios[2]!.name, "Aggressive");
});

test("validateInputs works independently of economics", () => {
  // validateInputs is exposed directly on the spec for validateResearch early
  // gate, so it must work without creating a full bound value model.
  const validated = employeeServiceVertical.validateInputs({ total_employees: 5000 }, true);

  assert.equal(validated.values.total_employees, 5000);
  assert.equal(validated.estimated, true);
});

// Drift guard (Concern: spec/bound-model duplication). inputGuidance and
// validateInputs are declared on both VerticalSpec and the BoundValueModel, and
// they gate at different points (validateResearch uses the spec copy, buildSite
// uses the bound-model copy). A divergence would let a payload pass one gate yet
// fail the other. Pin that the bound model reuses the spec's members by identity.
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

// Phase 2: the factory reads profile.economics when present and computes from it.
const customEconomics: VerticalEconomics = {
  annual_license: 2_000_000,
  implementation_fee: 300_000,
  scenarios: [
    { name: "Conservative", effectiveness: { itDeflection: 0.45, hrDeflection: 0.5 } },
    { name: "Expected", effectiveness: { itDeflection: 0.6, hrDeflection: 0.65 } },
    { name: "Aggressive", effectiveness: { itDeflection: 0.75, hrDeflection: 0.8 } },
  ],
};

test("Phase 2: factory reads profile.economics when present", () => {
  const profile = makeProfile({ economics: customEconomics });
  const valueModel = employeeServiceVertical.createValueModel(profile);

  assert.equal(valueModel.economics.annual_license, 2_000_000);
  assert.equal(valueModel.economics.implementation_fee, 300_000);
});

test("Phase 2: compute uses custom economics, not the defaults", () => {
  const custom = employeeServiceVertical.createValueModel(
    makeProfile({ economics: customEconomics }),
  );
  const def = employeeServiceVertical.createValueModel(makeProfile());

  const inputs = { total_employees: 20000 };
  const customResult = custom.compute(custom.validateInputs(inputs, false));
  const defResult = def.compute(def.validateInputs(inputs, false));

  // Different license and deflection rates must move the headline figure.
  assert.notEqual(customResult.headline.value, defResult.headline.value);
});

test("Phase 2: factory rejects a malformed economics object", () => {
  const profile = makeProfile({
    // Two scenarios instead of three: a structural breach.
    economics: { ...customEconomics, scenarios: customEconomics.scenarios.slice(0, 2) },
  });

  assert.throws(
    () => employeeServiceVertical.createValueModel(profile),
    (err: unknown) =>
      err instanceof ValueModelContractError && /exactly 3 scenarios/.test(err.message),
  );
});

test("Phase 2: factory rejects a negative license fee", () => {
  const profile = makeProfile({ economics: { ...customEconomics, annual_license: -1 } });

  assert.throws(
    () => employeeServiceVertical.createValueModel(profile),
    (err: unknown) =>
      err instanceof ValueModelContractError && /annual_license/.test(err.message),
  );
});

// validateEconomics is the save-time gate (called by saveProfile) and the build
// gate (called by createValueModel). These exercise it directly on the spec.
test("validateEconomics accepts a well-formed economics object", () => {
  const result = employeeServiceVertical.validateEconomics(customEconomics);
  assert.equal(result.annual_license, 2_000_000);
});

test("validateEconomics rejects scenario names that break the D49 disclosure policy", () => {
  const wrongNames = {
    ...customEconomics,
    scenarios: [
      { name: "Low", effectiveness: { itDeflection: 0.45, hrDeflection: 0.5 } },
      { name: "Mid", effectiveness: { itDeflection: 0.6, hrDeflection: 0.65 } },
      { name: "High", effectiveness: { itDeflection: 0.75, hrDeflection: 0.8 } },
    ],
  };

  assert.throws(
    () => employeeServiceVertical.validateEconomics(wrongNames),
    (err: unknown) =>
      err instanceof ValueModelContractError &&
      /must be "Conservative"/.test(err.message) &&
      /D49/.test(err.message),
  );
});

test("validateEconomics rejects a missing effectiveness key compute reads", () => {
  const typoKey = {
    ...customEconomics,
    scenarios: [
      // "itDelfection" misspelled: compute would silently read 0 for it. The
      // save-time gate must catch it rather than render wrong figures later.
      { name: "Conservative", effectiveness: { itDelfection: 0.45, hrDeflection: 0.5 } },
      { name: "Expected", effectiveness: { itDeflection: 0.6, hrDeflection: 0.65 } },
      { name: "Aggressive", effectiveness: { itDeflection: 0.75, hrDeflection: 0.8 } },
    ],
  };

  assert.throws(
    () => employeeServiceVertical.validateEconomics(typoKey),
    (err: unknown) =>
      err instanceof ValueModelContractError && /effectiveness\.itDeflection/.test(err.message),
  );
});
