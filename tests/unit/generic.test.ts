import { test } from "node:test";
import assert from "node:assert/strict";
import { genericVertical } from "../../src/verticals/generic.ts";
import { assertValueModelContract } from "../../src/verticals/contract.ts";
import { makeProfile } from "../fixtures/profile.ts";

const valueModel = genericVertical.createValueModel(makeProfile({ vertical: "generic" }));

test("compute returns three scenarios in the disclosure order", () => {
  const result = valueModel.compute(valueModel.validateInputs({}, true));
  assert.deepEqual(
    result.scenarios.map((s) => s.name),
    ["Conservative", "Expected", "Aggressive"],
  );
});

test("compute omits metrics and projection (qualitative model)", () => {
  const result = valueModel.compute(valueModel.validateInputs({}, false));
  assert.equal(result.metrics, undefined);
  assert.equal(result.projection, undefined);
});

test("the estimated flag drives the footnote", () => {
  assert.ok(valueModel.compute(valueModel.validateInputs({}, true)).footnote);
  assert.equal(valueModel.compute(valueModel.validateInputs({}, false)).footnote, undefined);
});

test("validateInputs carries arbitrary numeric inputs through untouched", () => {
  const v = valueModel.validateInputs({ total_employees: 5000 }, true);
  assert.equal(v.values.total_employees, 5000);
  assert.equal(v.estimated, true);
});

test("the scenario values name no dollar figure", () => {
  const result = valueModel.compute(valueModel.validateInputs({}, true));
  for (const s of result.scenarios) {
    assert.doesNotMatch(s.primaryValue, /\$\d/);
  }
});

test("compute satisfies the disclosure contract (estimated=true)", () => {
  const result = valueModel.compute(valueModel.validateInputs({}, true));
  assertValueModelContract(result, true);
});

test("compute satisfies the disclosure contract (estimated=false)", () => {
  const result = valueModel.compute(valueModel.validateInputs({}, false));
  assertValueModelContract(result, false);
});

test("validateEconomics enforces the shared disclosure shape", () => {
  assert.throws(
    () =>
      genericVertical.validateEconomics({
        annual_license: 0,
        implementation_fee: 0,
        scenarios: [{ name: "Low", effectiveness: {} }],
      }),
    /exactly 3 scenarios/,
  );
});

test("the spec carries no HR/ITSM framing", () => {
  const haystack =
    `${genericVertical.domains.join(" ")} ${genericVertical.domainGuidance} ` +
    `${genericVertical.executiveTargeting} ${genericVertical.inputGuidance}`;
  assert.doesNotMatch(haystack, /\b(HR|ITSM|CHRO|CIO|ticket|deflection)\b/i);
});
