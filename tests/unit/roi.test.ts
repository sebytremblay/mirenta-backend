// Unit tests for the deterministic ROI model (D38). These pin the formulas and
// the scenario ordering so a future change to the constants is a deliberate,
// visible edit rather than a silent drift.

import { test } from "node:test";
import assert from "node:assert/strict";
import { computeRoi, formatDollars } from "../../src/domain/roi.ts";
import type { RoiInputs } from "../../src/domain/research.ts";

const plexus: RoiInputs = {
  total_employees: 20000,
  it_staff: 150,
  hr_staff: 35,
  estimated: true,
};

test("computeRoi derives volume from headcount", () => {
  const roi = computeRoi(plexus);
  assert.equal(roi.totalEmployees, 20000);
  assert.equal(roi.annualItTickets, 20000 * 10);
  assert.equal(roi.annualHrInteractions, 20000 * 8);
});

test("computeRoi returns three scenarios in fixed order", () => {
  const roi = computeRoi(plexus);
  assert.deepEqual(
    roi.scenarios.map((s) => s.name),
    ["conservative", "expected", "aggressive"],
  );
});

test("savings increase across scenarios", () => {
  const roi = computeRoi(plexus);
  const [c, e, a] = roi.scenarios;
  assert.ok(c!.grossAnnualSavings < e!.grossAnnualSavings);
  assert.ok(e!.grossAnnualSavings < a!.grossAnnualSavings);
});

test("net savings subtract the annual license", () => {
  const roi = computeRoi(plexus);
  for (const s of roi.scenarios) {
    assert.equal(s.netAnnualSavings, s.grossAnnualSavings - roi.annualLicenseCost);
  }
});

test("headline equals the expected scenario net savings", () => {
  const roi = computeRoi(plexus);
  const expected = roi.scenarios.find((s) => s.name === "expected");
  assert.equal(roi.headlineNetAnnualSavings, expected!.netAnnualSavings);
});

test("staffEstimated flag carries through", () => {
  assert.equal(computeRoi(plexus).staffEstimated, true);
  assert.equal(computeRoi({ ...plexus, estimated: false }).staffEstimated, false);
});

test("zero employees yields zero volume without throwing", () => {
  const roi = computeRoi({ total_employees: 0, it_staff: 0, hr_staff: 0, estimated: true });
  assert.equal(roi.annualItTickets, 0);
  assert.equal(roi.annualHrInteractions, 0);
});

test("formatDollars renders compact figures", () => {
  assert.equal(formatDollars(2_600_000), "$2.6M");
  assert.equal(formatDollars(480_000), "$480K");
  assert.equal(formatDollars(9_200), "$9K");
  assert.equal(formatDollars(900), "$900");
  assert.equal(formatDollars(-1_500_000), "-$1.5M");
});
