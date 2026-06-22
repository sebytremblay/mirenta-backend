// Unit tests for the founder-led sales vertical value model (D38, D49, D59). These
// pin the founder-led formulas and the scenario ordering so a future change to the
// modeling assumptions is a deliberate, visible edit rather than a silent drift. The
// model turns a tiny team, a monthly send volume, a founder-scale deal value, a cold
// reply rate, and the hours a personalized touch costs into incremental closed deals,
// reclaimed founder time, and a first-year return expressed as a multiple, with no
// fabricated figures. The headline is a multiple ("4.2x"), not an ROI percent.

import { test } from "node:test";
import assert from "node:assert/strict";
import { founderLedSalesVertical } from "../../src/verticals/founder-led-sales.ts";
import { assertValueModelContract } from "../../src/verticals/contract.ts";
import { makeProfile } from "../fixtures/profile.ts";

// A profile with no economics override exercises the Phase 1 default economics,
// which these tests pin. The profile content does not otherwise affect the model.
const valueModel = founderLedSalesVertical.createValueModel(
  makeProfile({ vertical: "founder_led_sales" }),
);

// Worked example: team of 3, 40 one-pagers per month, $12,000 deal value, 0.04 cold
// reply rate, 1.0 hour per personalized touch. Derived expectations (default
// economics: no license, $1,000 implementation, $600/seat-year, base $8 + 0.003*acv):
//   prospectsYear   = 40 * 12 = 480
//   billedSeats     = ceil(480/240) = 2 (<= team 3)
//   pricePerProspect= 8 + 0.003*12000 = 44
//   usageAnnual     = 44 * 480 = 21,120
//   seatAnnual      = 600 * 2 = 1,200
//   effectiveLicense= 0 + 1,200 + 21,120 = 22,320
//   firstYearCost   = 22,320 + 1,000 = 23,320
//   Expected gross  = (480*0.04*0.9*0.20)*12000 + (480*1.0*0.8)*150 = 41,472 + 57,600 = 99,072
//   Expected net    = 99,072 - 22,320 = 76,752
//   headline multiple = 99,072 / 23,320 = 4.25 -> "4.2x"
function worked(estimated = false) {
  return valueModel.validateInputs(
    {
      team_size: 3,
      prospects_per_month: 40,
      avg_deal_value: 12000,
      baseline_reply_rate: 0.04,
      hours_per_personalized_touch: 1.0,
    },
    estimated,
  );
}

test("validateInputs requires team_size", () => {
  assert.throws(
    () => valueModel.validateInputs({ prospects_per_month: 40, avg_deal_value: 12000 }, false),
    /team_size/,
  );
});

test("validateInputs requires prospects_per_month", () => {
  assert.throws(
    () => valueModel.validateInputs({ team_size: 3, avg_deal_value: 12000 }, false),
    /prospects_per_month/,
  );
});

test("validateInputs requires avg_deal_value", () => {
  assert.throws(
    () => valueModel.validateInputs({ team_size: 3, prospects_per_month: 40 }, false),
    /avg_deal_value/,
  );
});

test("validateInputs defaults reply rate and per-touch hours when absent", () => {
  const v = valueModel.validateInputs(
    { team_size: 3, prospects_per_month: 40, avg_deal_value: 12000 },
    false,
  );
  assert.equal(v.values.baseline_reply_rate, 0.04);
  assert.equal(v.values.hours_per_personalized_touch, 1.0);
});

test("compute returns three scenarios in fixed order", () => {
  const result = valueModel.compute(worked());
  assert.deepEqual(
    result.scenarios.map((s) => s.name),
    ["Conservative", "Expected", "Aggressive"],
  );
});

test("compute pins the scenario net-value figures and multiple secondaries", () => {
  const result = valueModel.compute(worked());
  assert.deepEqual(
    result.scenarios.map((s) => s.primaryValue),
    ["$44K", "$77K", "$104K"],
  );
  for (const s of result.scenarios) {
    assert.equal(s.primaryLabel, "Value in year one");
    assert.match(s.secondary ?? "", /^\d+\.\dx$/);
  }
});

test("headline reports the expected first-year return as a multiple, not a percent", () => {
  const result = valueModel.compute(worked());
  assert.equal(result.headline.label, "Expected first-year return");
  assert.equal(result.headline.value, "4.2x");
  assert.doesNotMatch(result.headline.value, /%/);
  assert.equal(result.sectionTitle, "What you get back");
});

test("the estimated flag drives the footnote", () => {
  assert.match(valueModel.compute(worked(true)).footnote ?? "", /sharpen/);
  assert.equal(valueModel.compute(worked(false)).footnote, undefined);
});

// Metric tiles and projection for the worked example.
//   payback = 23,320 / (99,072 / 12) = 2.82 -> "2.8 mo"
//   hours returned (Expected) = 480 * 1.0 * 0.8 = 384 -> "384 hrs"
//   5-year cumulative under the ramp (0.6/0.9/1/1/1), year 1 absorbs the $1,000 fee:
//     44,571 / 113,528 / 190,280 / 267,032 / 343,784 -> "$45K"/"$114K"/"$190K"/"$267K"/"$344K"
test("metrics pins Payback period", () => {
  const m = valueModel.compute(worked()).metrics?.find((x) => x.label === "Payback period");
  assert.equal(m?.value, "2.8 mo");
});

test("metrics pins Hours returned per year", () => {
  const m = valueModel
    .compute(worked())
    .metrics?.find((x) => x.label === "Hours returned per year");
  assert.equal(m?.value, "384 hrs");
});

test("metrics pins Value in year one", () => {
  const m = valueModel.compute(worked()).metrics?.find((x) => x.label === "Value in year one");
  assert.equal(m?.value, "$77K");
});

test("projection series has 5 cumulative points", () => {
  const result = valueModel.compute(worked());
  assert.deepEqual(
    result.projection?.series.map((p) => p.display),
    ["$45K", "$114K", "$190K", "$267K", "$344K"],
  );
});

test("team_size clamps to 5 so the headcount input never exceeds the founder-led bound", () => {
  // An out-of-range team of 40 must not change the billed-seat math beyond the cap.
  const v = valueModel.validateInputs(
    { team_size: 40, prospects_per_month: 40, avg_deal_value: 12000 },
    false,
  );
  const result = valueModel.compute(v);
  // billedSeats = min(ceil(480/240)=2, clampedTeam 5) = 2, identical to the worked case.
  assert.equal(result.headline.value, "4.2x");
});

test("a zero send volume does not throw and produces a finite payback", () => {
  const v = valueModel.validateInputs(
    { team_size: 1, prospects_per_month: 0, avg_deal_value: 12000 },
    false,
  );
  const result = valueModel.compute(v);
  assert.equal(result.scenarios.length, 3);
  // prospects_per_month clamps up to the floor (8), so the funnel never collapses to
  // zero and payback stays finite.
  const payback = result.metrics?.find((m) => m.label === "Payback period");
  assert.notEqual(payback?.value, "n/a");
});

test("validateEconomics rejects a missing reply_uplift effectiveness key", () => {
  assert.throws(
    () =>
      founderLedSalesVertical.validateEconomics({
        annual_license: 0,
        implementation_fee: 1000,
        scenarios: [
          { name: "Conservative", effectiveness: { hours_recovered_per_prospect: 0.6 } },
          {
            name: "Expected",
            effectiveness: { reply_uplift: 0.9, hours_recovered_per_prospect: 0.8 },
          },
          {
            name: "Aggressive",
            effectiveness: { reply_uplift: 1.3, hours_recovered_per_prospect: 0.92 },
          },
        ],
      }),
    /reply_uplift/,
  );
});

test("validateEconomics rejects a missing hours_recovered_per_prospect key", () => {
  assert.throws(
    () =>
      founderLedSalesVertical.validateEconomics({
        annual_license: 0,
        implementation_fee: 1000,
        scenarios: [
          { name: "Conservative", effectiveness: { reply_uplift: 0.5 } },
          {
            name: "Expected",
            effectiveness: { reply_uplift: 0.9, hours_recovered_per_prospect: 0.8 },
          },
          {
            name: "Aggressive",
            effectiveness: { reply_uplift: 1.3, hours_recovered_per_prospect: 0.92 },
          },
        ],
      }),
    /hours_recovered_per_prospect/,
  );
});

test("validateEconomics rejects a wrong scenario name", () => {
  assert.throws(
    () =>
      founderLedSalesVertical.validateEconomics({
        annual_license: 0,
        implementation_fee: 1000,
        scenarios: [
          { name: "Low", effectiveness: { reply_uplift: 0.5, hours_recovered_per_prospect: 0.6 } },
          {
            name: "Expected",
            effectiveness: { reply_uplift: 0.9, hours_recovered_per_prospect: 0.8 },
          },
          {
            name: "Aggressive",
            effectiveness: { reply_uplift: 1.3, hours_recovered_per_prospect: 0.92 },
          },
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

test("the spec carries no enterprise-sales or HR/ITSM framing", () => {
  const haystack =
    `${founderLedSalesVertical.domains.join(" ")} ${founderLedSalesVertical.domainGuidance} ` +
    `${founderLedSalesVertical.executiveTargeting} ${founderLedSalesVertical.inputGuidance}`;
  assert.doesNotMatch(haystack, /\b(HR|ITSM|CHRO|CIO|ticket|deflection)\b/i);
  assert.doesNotMatch(
    haystack,
    /\b(quota|reps?|enablement|procurement|RFP|MQL|SDR|BDR|territory|six-figure|enterprise-grade)\b/i,
  );
});
