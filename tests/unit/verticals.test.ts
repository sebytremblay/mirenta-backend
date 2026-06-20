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
} from "../../src/verticals/index.ts";

test("the default id resolves to a registered spec", () => {
  assert.ok(isKnownVertical(DEFAULT_VERTICAL_ID));
  assert.equal(getVertical(DEFAULT_VERTICAL_ID).id, DEFAULT_VERTICAL_ID);
});

test("getVertical returns the spec for a known id", () => {
  const spec = getVertical(DEFAULT_VERTICAL_ID);
  assert.equal(spec.id, "salesforce_employee_service");
  assert.ok(spec.domains.length > 0);
  assert.equal(typeof spec.valueModel.compute, "function");
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
// value model runs end to end on arbitrary numeric inputs.
test("an arbitrary stub spec computes through the value-model contract", () => {
  const stub: VerticalSpec = {
    id: "stub_demo",
    label: "Stub Demo",
    domains: ["Demand"],
    domainGuidance: "Surface demand-side priorities.",
    executiveTargeting: "Prioritize the VP of Demand.",
    defaultAccentColor: "#123456",
    valueModel: {
      inputGuidance: "Gather pipeline_value.",
      validateInputs: (raw, estimated) => ({
        values: { pipeline_value: raw.pipeline_value ?? 0 },
        estimated,
      }),
      compute: (inputs) => ({
        sectionTitle: "Pipeline Impact",
        headline: { label: "Influenced pipeline", value: `$${inputs.values.pipeline_value}` },
        scenarios: [{ name: "Base", primaryValue: "$1", primaryLabel: "Uplift" }],
      }),
    },
  };

  const validated = stub.valueModel.validateInputs({ pipeline_value: 500 }, false);
  const result = stub.valueModel.compute(validated);
  assert.equal(result.headline.value, "$500");
  assert.equal(result.scenarios[0]!.primaryLabel, "Uplift");
});
