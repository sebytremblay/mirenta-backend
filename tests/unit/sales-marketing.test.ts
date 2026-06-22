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
// booked meetings per rep per year. The default economics price per seat
// ($1,200/year, no fixed license, no implementation fee), so the effective license
// is 1,200 * 100 reps = 120,000. Derived expectations:
//   baselineMeetings = 100 * 60 = 6,000
//   Expected uplift 0.20 -> 1,200 incremental meetings
//   incremental won deals = 1,200 * 0.05 = 60
//   Expected gross = 60 * 50,000 = 3,000,000
//   Expected net   = 3,000,000 - 120,000 license = 2,880,000
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
//   firstYearCost = 120,000 license + 0 implementation = 120,000
//   ROI           = round(2,880,000 / 120,000 * 100) = 2400%
//   Payback       = 120,000 / (3,000,000 / 12)        = 0.5 mo
//   Annual cash flows (ramp 0.5/0.8/1/1/1, no implementation fee):
//     1,380,000 / 2,280,000 / 2,880,000 / 2,880,000 / 2,880,000
//   Cumulative: 1,380,000 / 3,660,000 / 6,540,000 / 9,420,000 / 12,300,000

test("metrics pins Expected ROI", () => {
  const roi = valueModel.compute(worked()).metrics?.find((m) => m.label === "Expected ROI");
  assert.equal(roi?.value, "2400%");
});

test("metrics pins Payback period", () => {
  const payback = valueModel.compute(worked()).metrics?.find((m) => m.label === "Payback period");
  assert.equal(payback?.value, "0.5 mo");
});

test("metrics pins 5-year net new revenue", () => {
  const m = valueModel.compute(worked()).metrics?.find((x) => x.label === "5-year net new revenue");
  assert.equal(m?.value, "$12.3M");
});

test("projection series has 5 cumulative points", () => {
  const result = valueModel.compute(worked());
  assert.deepEqual(
    result.projection?.series.map((p) => p.display),
    ["$1.4M", "$3.7M", "$6.5M", "$9.4M", "$12.3M"],
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

test("per-seat price scales the license with the rep count, keeping single-rep ROI positive", () => {
  // The self-sell failure: scoping impact to one AE without scoping price left the
  // org-scale license ($150K) against one rep's pipeline, so ROI went negative. The
  // per-seat default ($1,200/year) prices one seat for a one-rep page, so the small
  // but real incremental pipeline still clears the cost and ROI reads positive.
  const oneRep = valueModel.validateInputs(
    { quota_carrying_reps: 1, avg_deal_size: 80000, baseline_meetings_per_rep_year: 30 },
    true,
  );
  const result = valueModel.compute(oneRep);
  const roi = result.metrics?.find((m) => m.label === "Expected ROI");
  // Expected: gross = 1 * 30 * 0.2 * 0.05 * 80,000 = 24,000; net = 24,000 - 1,200 =
  // 22,800; ROI = round(22,800 / 1,200 * 100) = 1900%.
  assert.equal(roi?.value, "1900%");
  for (const s of result.scenarios) {
    assert.doesNotMatch(s.secondary ?? "", /^-/); // no negative ROI on any scenario card
  }
});

test("per-seat price scales the license with the rep count for a leader's span", () => {
  // A leader page scopes impact to the whole team, and the per-seat price scopes the
  // license to that same team, so the business case stays proportional rather than
  // exploding the way a fixed license against a large roster would.
  const team = valueModel.validateInputs(
    { quota_carrying_reps: 50, avg_deal_size: 80000, baseline_meetings_per_rep_year: 30 },
    true,
  );
  const result = valueModel.compute(team);
  // Effective license = 1,200 * 50 = 60,000. Expected gross = 50 * 30 * 0.2 * 0.05 *
  // 80,000 = 1,200,000; net = 1,140,000; ROI = round(1,140,000 / 60,000 * 100) = 1900%.
  const roi = result.metrics?.find((m) => m.label === "Expected ROI");
  assert.equal(roi?.value, "1900%");
});

test("inputGuidance scopes the rep roster to the lead's span of control", () => {
  // The value model multiplies quota_carrying_reps through the uplift, so a
  // company-wide count for a page that targets one person overstates the
  // opportunity by orders of magnitude (the self-sell run that produced a
  // 947,833% ROI for a single AE against Salesforce's full roster). The guidance
  // must instruct the agent to size the roster to what the lead owns: 1 for an
  // individual contributor, the team for a leader, the whole org for a C-level.
  const guidance = salesMarketingVertical.inputGuidance;
  assert.match(guidance, /span of control/i);
  assert.match(guidance, /individual contributor/i);
  assert.match(guidance, /\b1\b/); // an IC scopes to one rep
});

test("the spec carries no HR/ITSM framing", () => {
  const haystack =
    `${salesMarketingVertical.domains.join(" ")} ${salesMarketingVertical.domainGuidance} ` +
    `${salesMarketingVertical.executiveTargeting} ${salesMarketingVertical.inputGuidance}`;
  assert.doesNotMatch(haystack, /\b(HR|ITSM|CHRO|CIO|ticket|deflection)\b/i);
});
