import { test } from "node:test";
import assert from "node:assert/strict";
import { employeeServiceVertical } from "../../src/verticals/employee-service.ts";
import { assertValueModelContract } from "../../src/verticals/contract.ts";
import { makeProfile } from "../fixtures/profile.ts";

const valueModel = employeeServiceVertical.createValueModel(makeProfile());

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

test("metrics pins Expected ROI for plexus inputs", () => {
  const result = valueModel.compute(plexusInputs());
  const roi = result.metrics?.find((m) => m.label === "Expected ROI");
  assert.equal(roi?.value, "156%");
});

test("metrics pins Payback period for plexus inputs", () => {
  const result = valueModel.compute(plexusInputs());
  const payback = result.metrics?.find((m) => m.label === "Payback period");
  assert.equal(payback?.value, "4.9 mo");
});

test("metrics pins 5-year net savings for plexus inputs", () => {
  const result = valueModel.compute(plexusInputs());
  const savings = result.metrics?.find((m) => m.label === "5-year net savings");
  assert.equal(savings?.value, "$10.1M");
});

test("metrics pins NPV at 8 percent for plexus inputs", () => {
  const result = valueModel.compute(plexusInputs());
  const npv = result.metrics?.find((m) => m.label === "NPV at 8 percent");
  assert.equal(npv?.value, "$7.8M");
});

test("projection series has 5 points with correct periods", () => {
  const result = valueModel.compute(plexusInputs());
  assert.equal(result.projection?.series.length, 5);
  assert.deepEqual(
    result.projection?.series.map((p) => p.period),
    ["Year 1", "Year 2", "Year 3", "Year 4", "Year 5"],
  );
});

test("projection series display values match cumulative targets", () => {
  const result = valueModel.compute(plexusInputs());
  assert.deepEqual(
    result.projection?.series.map((p) => p.display),
    ["$374K", "$2.2M", "$4.8M", "$7.5M", "$10.1M"],
  );
});

test("zero employees does not throw and produces metrics and 5-point projection", () => {
  const v = valueModel.validateInputs({ total_employees: 0 }, false);
  const result = valueModel.compute(v);
  assert.ok(Array.isArray(result.metrics));
  assert.equal(result.projection?.series.length, 5);
  const payback = result.metrics?.find((m) => m.label === "Payback period");
  assert.ok(payback?.value !== "Infinity mo" && payback?.value !== "NaN mo");
});

test("compute satisfies the disclosure contract (estimated=true)", () => {
  const result = valueModel.compute(plexusInputs(true));
  assertValueModelContract(result, true);
});

test("compute satisfies the disclosure contract (estimated=false)", () => {
  const result = valueModel.compute(plexusInputs(false));
  assertValueModelContract(result, false);
});
