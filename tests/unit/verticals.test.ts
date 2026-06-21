// Unit tests for the vertical registry. The generic pipeline resolves the active
// VerticalSpec by id at runtime, so the lookup, the unknown-id rejection, and the
// default id are load-bearing and pinned here. A second stub spec proves the seam
// is real: the registry holds any spec, not just the employee-service one.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_VERTICAL_ID,
  getVertical,
  isKnownVertical,
  VERTICALS,
  type VerticalSpec,
  type VerticalEconomics,
} from "../../src/verticals/index.ts";
import { assertValueModelContract } from "../../src/verticals/contract.ts";
import { makeProfile } from "../fixtures/profile.ts";

test("the default id resolves to a registered spec", () => {
  assert.ok(isKnownVertical(DEFAULT_VERTICAL_ID));
  assert.equal(getVertical(DEFAULT_VERTICAL_ID).id, DEFAULT_VERTICAL_ID);
});

test("getVertical returns the spec for a known id", () => {
  const spec = getVertical(DEFAULT_VERTICAL_ID);
  assert.equal(spec.id, "salesforce_employee_service");
  assert.ok(spec.domains.length > 0);
  assert.equal(typeof spec.createValueModel, "function");
  assert.equal(typeof spec.defaultEconomics, "function");
});

test("getVertical throws on an unknown id", () => {
  assert.throws(() => getVertical("no_such_vertical"), /unknown vertical/);
});

test("isKnownVertical rejects an unregistered id", () => {
  assert.equal(isKnownVertical("no_such_vertical"), false);
});

test("every registered spec keys on its own id", () => {
  for (const [key, spec] of Object.entries(VERTICALS)) {
    assert.equal(key, spec.id, `registry key ${key} must match spec id ${spec.id}`);
  }
});

// Prove the seam: a minimal stub spec satisfies the VerticalSpec contract with no
// HR/ITSM assumption. The type-check alone guards the structural contract; the
// value model runs end to end on arbitrary numeric inputs. The stub satisfies the
// D38/D49 contract (3 scenarios with correct names, footnote when estimated).
test("an arbitrary stub spec computes through the value-model contract", () => {
  const stub: VerticalSpec = {
    id: "stub_demo",
    label: "Stub Demo",
    domains: ["Demand"],
    domainGuidance: "Surface demand-side priorities.",
    executiveTargeting: "Prioritize the VP of Demand.",
    defaultAccentColor: "#123456",
    inputGuidance: "Gather pipeline_value.",
    validateInputs: (raw, estimated) => ({
      values: { pipeline_value: raw.pipeline_value ?? 0 },
      estimated,
    }),
    createValueModel: () => ({
      inputGuidance: "Gather pipeline_value.",
      validateInputs: (raw, estimated) => ({
        values: { pipeline_value: raw.pipeline_value ?? 0 },
        estimated,
      }),
      compute: (inputs) => ({
        sectionTitle: "Pipeline Impact",
        headline: { label: "Influenced pipeline", value: `$${inputs.values.pipeline_value}` },
        // D38/D49 contract: exactly 3 scenarios with these names
        scenarios: [
          { name: "Conservative", primaryValue: "$100K", primaryLabel: "Uplift" },
          { name: "Expected", primaryValue: "$200K", primaryLabel: "Uplift" },
          { name: "Aggressive", primaryValue: "$300K", primaryLabel: "Uplift" },
        ],
        footnote: inputs.estimated ? "Estimated from benchmarks." : undefined,
      }),
      economics: {
        annual_license: 500_000,
        implementation_fee: 50_000,
        scenarios: [
          { name: "Conservative", effectiveness: { uplift: 0.05 } },
          { name: "Expected", effectiveness: { uplift: 0.1 } },
          { name: "Aggressive", effectiveness: { uplift: 0.15 } },
        ],
      },
    }),
    defaultEconomics: () => ({
      annual_license: 500_000,
      implementation_fee: 50_000,
      scenarios: [
        { name: "Conservative", effectiveness: { uplift: 0.05 } },
        { name: "Expected", effectiveness: { uplift: 0.1 } },
        { name: "Aggressive", effectiveness: { uplift: 0.15 } },
      ],
    }),
    // The stub trusts its inputs; the seam only requires the method to exist.
    validateEconomics: (raw) => raw as VerticalEconomics,
  };

  const profile = makeProfile({ vertical: "stub_demo" });

  const valueModel = stub.createValueModel(profile);
  const validated = valueModel.validateInputs({ pipeline_value: 500 }, true);
  const result = valueModel.compute(validated);

  assert.equal(result.headline.value, "$500");
  assert.equal(result.scenarios.length, 3);
  assert.equal(result.scenarios[0]!.primaryLabel, "Uplift");

  // Contract enforcement: verify stub satisfies D38/D49 policy
  assertValueModelContract(result, true);
});
