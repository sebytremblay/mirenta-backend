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

test("the default id resolves to the neutral generic spec", () => {
  assert.ok(isKnownVertical(DEFAULT_VERTICAL_ID));
  assert.equal(DEFAULT_VERTICAL_ID, "generic");
  assert.equal(getVertical(DEFAULT_VERTICAL_ID).id, DEFAULT_VERTICAL_ID);
});

test("getVertical returns the spec for a known id", () => {
  const spec = getVertical(DEFAULT_VERTICAL_ID);
  assert.equal(spec.id, "generic");
  assert.ok(spec.domains.length > 0);
  assert.equal(typeof spec.createValueModel, "function");
  assert.equal(typeof spec.defaultEconomics, "function");
});

test("the registry holds the generic, employee-service, and sales-marketing specs", () => {
  for (const id of ["generic", "salesforce_employee_service", "sales_marketing"]) {
    assert.ok(isKnownVertical(id), `${id} must be registered`);
    assert.equal(getVertical(id).id, id);
  }
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

test("an arbitrary stub spec computes through the value-model contract", () => {
  const stub: VerticalSpec = {
    id: "stub_demo",
    label: "Stub Demo",
    domains: ["Demand"],
    domainGuidance: "Surface demand-side priorities.",
    voiceTargeting: "Prioritize the VP of Demand.",
    defaultAccentColor: "#123456",
    inputGuidance: "Gather pipeline_value.",
    validateInputs: (raw, estimated, context = {}) => ({
      values: { pipeline_value: raw.pipeline_value ?? 0 },
      context: { ...context },
      estimated,
    }),
    createValueModel: () => ({
      inputGuidance: "Gather pipeline_value.",
      validateInputs: (raw, estimated, context = {}) => ({
        values: { pipeline_value: raw.pipeline_value ?? 0 },
        context: { ...context },
        estimated,
      }),
      compute: (inputs) => ({
        sectionTitle: "Pipeline Impact",
        headline: { label: "Influenced pipeline", value: `$${inputs.values.pipeline_value}` },
        mechanism: "The model maps influenced pipeline to the seller's motion.",
        footnote: inputs.estimated ? "Estimated from benchmarks." : undefined,
      }),
      economics: {},
    }),
    defaultEconomics: () => ({}),
    validateEconomics: (raw) => raw as VerticalEconomics,
  };

  const profile = makeProfile({ vertical: "stub_demo" });

  const valueModel = stub.createValueModel(profile);
  const validated = valueModel.validateInputs({ pipeline_value: 500 }, true);
  const result = valueModel.compute(validated);

  assert.equal(result.headline.value, "$500");
  assert.ok(result.mechanism.length > 0);

  assertValueModelContract(result, true);
});
