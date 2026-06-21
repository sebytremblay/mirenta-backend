// Unit tests for the sales-marketing vertical value model (D38, D49). These pin
// the pipeline-uplift formulas and the scenario ordering so a future change to the
// modeling assumptions is a deliberate, visible edit rather than a silent drift.
// The model turns a rep roster and an average deal size into incremental booked
// meetings, incremental closed-won deals, and the net new annual revenue that
// follows, with no fabricated figures.

import { test } from "node:test";
import assert from "node:assert/strict";
import { salesMarketingVertical } from "../../src/verticals/sales-marketing.ts";
import { assertValueModelContract } from "../../src/verticals/contract.ts";
import { makeProfile } from "../fixtures/profile.ts";

// A profile with no economics override exercises the Phase 1 default economics,
// which these tests pin. The profile content does not otherwise affect the model.
const valueModel = salesMarketingVertical.createValueModel(makeProfile({ vertical: "sales_marketing" }));

// Worked example: 100 quota-carrying reps, $50,000 average deal, 60 baseline
// booked meetings per rep per year. Derived expectations:
//   baselineMeetings = 100 * 60 = 6,000
//   Expected uplift 0.20 -> 1,200 incremental meetings
//   incremental won deals = 1,200 * 0.05 = 60
//   Expected gross = 60 * 50,000 = 3,000,000
//   Expected net   = 3,000,000 - 150,000 license = 2,850,000
function worked(estimated = false) {
  return valueModel.validateInputs(
    { quota_carrying_reps: 100, avg_deal_size: 50000, baseline_meetings_per_rep_year: 60 },
    estimated,
  );
}

test("validateInputs requires quota_carrying_reps", () => {
  assert.throws(() => valueModel.validateInputs({ avg_deal_size: 50000 }, false), /quota_carrying_reps/);
});

test("validateInputs requires avg_deal_size", () => {
  assert.throws(
    () => valueModel.validateInputs({ quota_carrying_reps: 100 }, false),
    /avg_deal_size/,
  );
});

test("validateInputs defaults baseline meetings per rep when absent", () => {
  const v = valueModel.validateInputs({ quota_carrying_reps: 100, avg_deal_size: 50000 }, false);
  assert.equal(v.values.baseline_meetings_per_rep_year, 60);
});

test("compute returns three scenarios in fixed order", () => {
  const result = valueModel.compute(worked());
  assert.deepEqual(
    result.scenarios.map((s) => s.name),
    ["Conservative", "Expected", "Aggressive"],
  );
});

test("compute pins the scenario net-revenue figures", () => {
  const result = valueModel.compute(worked());
  assert.deepEqual(
    result.scenarios.map((s) => s.primaryValue),
    ["$1.4M", "$2.9M", "$5.1M"],
  );
  for (const s of result.scenarios) {
    assert.equal(s.primaryLabel, "Net new annual revenue");
    assert.match(s.secondary ?? "", /% ROI$/);
  }
});

test("headline reports the expected scenario net new revenue", () => {
  const result = valueModel.compute(worked());
  assert.equal(result.headline.label, "Expected net new annual revenue");
  assert.equal(result.headline.value, "$2.9M");
  assert.equal(result.sectionTitle, "Business Value");
});

test("the estimated flag drives the footnote", () => {
  assert.match(valueModel.compute(worked(true)).footnote ?? "", /benchmark/);
  assert.equal(valueModel.compute(worked(false)).footnote, undefined);
});

// Metrics and projection: derived expectations for the worked example.
//   firstYearCost = 150,000 + 30,000 = 180,000
//   ROI           = round(2,850,000 / 180,000 * 100) = 1583%
//   Payback       = 180,000 / (3,000,000 / 12)       = 0.7 mo
//   Annual cash flows (ramp 0.5/0.8/1/1/1, year 1 absorbs the 30,000 fee):
//     1,320,000 / 2,250,000 / 2,850,000 / 2,850,000 / 2,850,000
//   Cumulative: 1,320,000 / 3,570,000 / 6,420,000 / 9,270,000 / 12,120,000

test("metrics pins Expected ROI", () => {
  const roi = valueModel.compute(worked()).metrics?.find((m) => m.label === "Expected ROI");
  assert.equal(roi?.value, "1583%");
});

test("metrics pins Payback period", () => {
  const payback = valueModel.compute(worked()).metrics?.find((m) => m.label === "Payback period");
  assert.equal(payback?.value, "0.7 mo");
});

test("metrics pins 5-year net new revenue", () => {
  const m = valueModel.compute(worked()).metrics?.find((x) => x.label === "5-year net new revenue");
  assert.equal(m?.value, "$12.1M");
});

test("projection series has 5 cumulative points", () => {
  const result = valueModel.compute(worked());
  assert.deepEqual(
    result.projection?.series.map((p) => p.display),
    ["$1.3M", "$3.6M", "$6.4M", "$9.3M", "$12.1M"],
  );
});

test("zero reps does not throw and produces a defined result without Infinity payback", () => {
  const v = valueModel.validateInputs({ quota_carrying_reps: 0, avg_deal_size: 50000 }, false);
  const result = valueModel.compute(v);
  assert.equal(result.scenarios.length, 3);
  const payback = result.metrics?.find((m) => m.label === "Payback period");
  assert.equal(payback?.value, "n/a");
});

test("validateEconomics rejects a missing meeting_uplift effectiveness key", () => {
  assert.throws(
    () =>
      salesMarketingVertical.validateEconomics({
        annual_license: 150_000,
        implementation_fee: 30_000,
        scenarios: [
          { name: "Conservative", effectiveness: {} },
          { name: "Expected", effectiveness: { meeting_uplift: 0.2 } },
          { name: "Aggressive", effectiveness: { meeting_uplift: 0.35 } },
        ],
      }),
    /meeting_uplift/,
  );
});

test("validateEconomics rejects a wrong scenario name", () => {
  assert.throws(
    () =>
      salesMarketingVertical.validateEconomics({
        annual_license: 150_000,
        implementation_fee: 30_000,
        scenarios: [
          { name: "Low", effectiveness: { meeting_uplift: 0.1 } },
          { name: "Expected", effectiveness: { meeting_uplift: 0.2 } },
          { name: "Aggressive", effectiveness: { meeting_uplift: 0.35 } },
        ],
      }),
    /Conservative/,
  );
});

test("compute satisfies the D38/D49 disclosure contract (estimated=true)", () => {
  assertValueModelContract(valueModel.compute(worked(true)), true);
});

test("compute satisfies the D38/D49 disclosure contract (estimated=false)", () => {
  assertValueModelContract(valueModel.compute(worked(false)), false);
});

test("the spec carries no HR/ITSM framing", () => {
  const haystack =
    `${salesMarketingVertical.domains.join(" ")} ${salesMarketingVertical.domainGuidance} ` +
    `${salesMarketingVertical.executiveTargeting} ${salesMarketingVertical.inputGuidance}`;
  assert.doesNotMatch(haystack, /\b(HR|ITSM|CHRO|CIO|ticket|deflection)\b/i);
});
