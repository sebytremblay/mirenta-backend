import { test } from "node:test";
import assert from "node:assert/strict";
import { employeeServiceVertical } from "../../src/verticals/employee-service.ts";
import { assertValueModelContract, ValueModelContractError } from "../../src/verticals/contract.ts";
import { makeProfile } from "../fixtures/profile.ts";

const valueModel = employeeServiceVertical.createValueModel(makeProfile());

test("validateInputs requires total_employees", () => {
  assert.throws(() => valueModel.validateInputs({ it_staff: 10 }, false), /total_employees/);
});

test("validateInputs keeps the total employee count", () => {
  const v = valueModel.validateInputs({ total_employees: 20000 }, false);
  assert.equal(v.values.total_employees, 20000);
});

test("compute renders the basis-points rate as the headline", () => {
  const result = valueModel.compute(valueModel.validateInputs({ total_employees: 20000 }, true));
  assert.equal(result.headline.value, "roughly 35 basis points of annual operating spend");
  assert.equal(result.headline.label, "Annual operating spend returned");
  assert.equal(result.sectionTitle, "What an autonomous support layer returns");
});

test("mechanism references the employee count", () => {
  const result = valueModel.compute(valueModel.validateInputs({ total_employees: 20000 }, true));
  assert.match(result.mechanism, /20000/);
});

test("the estimated flag drives the footnote", () => {
  const estimated = valueModel.compute(valueModel.validateInputs({ total_employees: 20000 }, true));
  assert.match(estimated.footnote ?? "", /estimated/);
  const exact = valueModel.compute(valueModel.validateInputs({ total_employees: 20000 }, false));
  assert.equal(exact.footnote, undefined);
});

test("zero employees yields a defined result without throwing", () => {
  const v = valueModel.validateInputs({ total_employees: 0 }, false);
  const result = valueModel.compute(v);
  assert.equal(result.headline.value, "roughly 35 basis points of annual operating spend");
});

test("compute satisfies the disclosure contract (estimated=true)", () => {
  const result = valueModel.compute(valueModel.validateInputs({ total_employees: 20000 }, true));
  assertValueModelContract(result, true);
});

test("compute satisfies the disclosure contract (estimated=false)", () => {
  const result = valueModel.compute(valueModel.validateInputs({ total_employees: 20000 }, false));
  assertValueModelContract(result, false);
});

test("validateEconomics rejects a missing or non-positive savings rate", () => {
  assert.throws(() => employeeServiceVertical.validateEconomics({}), ValueModelContractError);
  assert.throws(
    () => employeeServiceVertical.validateEconomics({ savings_basis_points: 0 }),
    ValueModelContractError,
  );
});

test("validateEconomics accepts a positive savings rate", () => {
  assert.doesNotThrow(() => employeeServiceVertical.validateEconomics({ savings_basis_points: 35 }));
});

test("createValueModel reads profile economics when present", () => {
  const model = employeeServiceVertical.createValueModel(
    makeProfile({ economics: { savings_basis_points: 50 } }),
  );
  const result = model.compute(model.validateInputs({ total_employees: 20000 }, false));
  assert.equal(result.headline.value, "roughly 50 basis points of annual operating spend");
});
