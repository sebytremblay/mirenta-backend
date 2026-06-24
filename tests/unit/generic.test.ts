import { test } from "node:test";
import assert from "node:assert/strict";
import { genericVertical } from "../../src/verticals/generic.ts";
import { assertValueModelContract } from "../../src/verticals/contract.ts";
import { makeProfile } from "../fixtures/profile.ts";

const valueModel = genericVertical.createValueModel(makeProfile({ vertical: "generic" }));

test("compute emits a qualitative claim with no dollar figure and no standalone digit", () => {
  const result = valueModel.compute(valueModel.validateInputs({}, true));
  assert.doesNotMatch(result.headline.value, /\$|\d/);
  assert.equal(typeof result.mechanism, "string");
  assert.ok(result.mechanism.length > 0);
});

test("the result carries no scenarios, metrics, or projection fields", () => {
  const result = valueModel.compute(valueModel.validateInputs({}, false));
  const bag = result as unknown as Record<string, unknown>;
  assert.equal(bag.scenarios, undefined);
  assert.equal(bag.metrics, undefined);
  assert.equal(bag.projection, undefined);
});

test("the estimated flag drives the footnote", () => {
  assert.ok(valueModel.compute(valueModel.validateInputs({}, true)).footnote);
  assert.equal(valueModel.compute(valueModel.validateInputs({}, false)).footnote, undefined);
});

test("validateInputs carries arbitrary numeric values and context through untouched", () => {
  const v = valueModel.validateInputs({ total_employees: 5000 }, true, { x: "y" });
  assert.equal(v.values.total_employees, 5000);
  assert.equal(v.context.x, "y");
  assert.equal(v.estimated, true);
});

test("compute satisfies the disclosure contract (estimated=true)", () => {
  const result = valueModel.compute(valueModel.validateInputs({}, true));
  assertValueModelContract(result, true);
});

test("compute satisfies the disclosure contract (estimated=false)", () => {
  const result = valueModel.compute(valueModel.validateInputs({}, false));
  assertValueModelContract(result, false);
});

test("validateEconomics rejects a non-object and accepts an object", () => {
  assert.throws(() => genericVertical.validateEconomics(null), /economics must be an object/);
  assert.throws(() => genericVertical.validateEconomics(42), /economics must be an object/);
  assert.doesNotThrow(() => genericVertical.validateEconomics({}));
});

test("the spec carries no HR or ITSM framing", () => {
  const haystack =
    `${genericVertical.domains.join(" ")} ${genericVertical.domainGuidance} ` +
    `${genericVertical.voiceTargeting} ${genericVertical.inputGuidance}`;
  assert.doesNotMatch(haystack, /\b(HR|ITSM|CHRO|CIO|ticket|deflection)\b/i);
});
