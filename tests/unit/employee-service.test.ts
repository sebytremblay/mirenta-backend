// Unit tests for the employee-service vertical value model (D38, D49). These pin
// the support-deflection formulas and the scenario ordering so a future change to
// the constants is a deliberate, visible edit rather than a silent drift. The math
// moved intact from the former domain/roi.ts into the vertical spec; these tests
// move with it and assert against the vertical-neutral ValueResult.

import { test } from "node:test";
import assert from "node:assert/strict";
import { employeeServiceVertical } from "../../src/verticals/employee-service.ts";

const { valueModel } = employeeServiceVertical;

// 20000 employees: the reference Plexus account. Derived expectations:
//   IT cost   = 20000 * 10 * 22 = 4,400,000
//   HR cost   = 20000 *  8 * 18 = 2,880,000
//   Expected  = 4.4M*0.55 + 2.88M*0.60 - 1.5M license = 2,648,000 net
function plexusInputs(estimated = true) {
  return valueModel.validateInputs(
    { total_employees: 20000, it_staff: 150, hr_staff: 35 },
    estimated,
  );
}

test("validateInputs requires total_employees", () => {
  assert.throws(() => valueModel.validateInputs({ it_staff: 10 }, false), /total_employees/);
});

test("validateInputs defaults missing staff counts to zero", () => {
  const v = valueModel.validateInputs({ total_employees: 1000 }, false);
  assert.equal(v.values.it_staff, 0);
  assert.equal(v.values.hr_staff, 0);
});

test("compute returns three scenarios in fixed order", () => {
  const result = valueModel.compute(plexusInputs());
  assert.deepEqual(
    result.scenarios.map((s) => s.name),
    ["Conservative", "Expected", "Aggressive"],
  );
});

test("compute pins the scenario net-savings figures", () => {
  const result = valueModel.compute(plexusInputs());
  assert.deepEqual(
    result.scenarios.map((s) => s.primaryValue),
    ["$1.6M", "$2.6M", "$3.7M"],
  );
  for (const s of result.scenarios) {
    assert.equal(s.primaryLabel, "Net Annual Savings");
    assert.match(s.secondary ?? "", /% ROI$/);
  }
});

test("headline reports the expected scenario net savings", () => {
  const result = valueModel.compute(plexusInputs());
  assert.equal(result.headline.label, "Expected net annual savings");
  assert.equal(result.headline.value, "$2.6M");
  assert.equal(result.sectionTitle, "Business Value");
});

test("the estimated flag drives the footnote", () => {
  assert.match(valueModel.compute(plexusInputs(true)).footnote ?? "", /estimated/);
  assert.equal(valueModel.compute(plexusInputs(false)).footnote, undefined);
});

test("zero employees yields a defined result without throwing", () => {
  const v = valueModel.validateInputs({ total_employees: 0 }, false);
  const result = valueModel.compute(v);
  assert.equal(result.scenarios.length, 3);
});
