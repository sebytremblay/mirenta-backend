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
//   Expected revenue= (480*0.04*0.9*0.20)*12000 = 41,472 (deals won)
//   Expected time   = (480*1.0*0.8)*150 = 57,600 (384 founder hours at $150)
//   Expected gross  = 41,472 + 57,600 = 99,072
//   Displayed thousands: value 99K, cost 23K (round(23,320/1000)).
//   headline multiple = 99K / 23K = 4.30 -> "4.3x" (derived from the displayed
//   thousands, so value over cost on the page returns the shown multiple exactly).
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

test("compute pins the scenario value-created figures and multiple secondaries", () => {
  // Gross value created per scenario (default economics, worked inputs):
  //   Conservative = (480*0.04*0.5*0.20)*12000 + (480*1.0*0.6)*150 = 23,040 + 43,200 = 66,240 -> "$66K"
  //   Expected     = 41,472 + 57,600 = 99,072 -> "$99K"
  //   Aggressive   = (480*0.04*1.3*0.20)*12000 + (480*1.0*0.92)*150 = 59,904 + 66,240 = 126,144 -> "$126K"
  const result = valueModel.compute(worked());
  assert.deepEqual(
    result.scenarios.map((s) => s.primaryValue),
    ["$66K", "$99K", "$126K"],
  );
  // Multiples derive from displayed thousands: 66/23=2.9, 99/23=4.3, 126/23=5.5.
  assert.deepEqual(
    result.scenarios.map((s) => s.secondary),
    ["2.9x", "4.3x", "5.5x"],
  );
  for (const s of result.scenarios) {
    assert.equal(s.primaryLabel, "Value created");
    assert.match(s.secondary ?? "", /^\d+\.\dx$/);
  }
});

test("every scenario reconciles to the displayed cost: displayed value divided by displayed multiple lands on the cost tile", () => {
  // The G3 reviewers caught a version where the multiple came from the raw figures
  // while the page showed rounded thousands, so a founder dividing the displayed
  // value by the displayed multiple got three costs, none equal to the cost tile,
  // and the multiples read as rounded down. Now the multiple derives from the SAME
  // displayed thousands the page shows, so the founder's own division on the page
  // returns the displayed cost in every card.
  const result = valueModel.compute(worked());
  const costTile = result.metrics?.find((m) => m.label === "First-year cost");
  assert.equal(costTile?.value, "$23K"); // costK * 1000 -> "$23K"
  const displayedCost = 23_000;
  for (const s of result.scenarios) {
    const value = Number(s.primaryValue.replace(/[$K]/g, "")) * 1000;
    const multiple = Number((s.secondary ?? "").replace("x", ""));
    const impliedCost = value / multiple;
    // Each card divides back to the displayed $23K within one-decimal-multiple rounding.
    assert.ok(
      Math.abs(impliedCost - displayedCost) < 500,
      `${s.name}: implied cost ${impliedCost} should reconcile to the displayed ${displayedCost}`,
    );
  }
});

test("the headline multiple equals the Expected scenario card multiple", () => {
  // The hero figure derives from the same displayed thousands as the Expected card,
  // so the number a founder reads in the hero matches the one in the business case.
  const result = valueModel.compute(worked());
  const expectedCard = result.scenarios.find((s) => s.name === "Expected");
  assert.equal(result.headline.value, expectedCard?.secondary);
});

test("headline reports the expected first-year return as a multiple, not a percent", () => {
  const result = valueModel.compute(worked());
  assert.equal(result.headline.label, "Expected first-year return");
  assert.equal(result.headline.value, "4.3x"); // 99K / 23K from displayed thousands
  assert.doesNotMatch(result.headline.value, /%/);
  assert.equal(result.sectionTitle, "What you get back");
});

test("the footnote names the deal-revenue and founder-time split with figures that sum to the value created", () => {
  // The G3 reviewers read one opaque "value created" total as decoration and flagged
  // that more than half rode on imputed time they could not see. The footnote now
  // names both terms with their own dollar figures (deal revenue plus founder time)
  // that sum to the Expected value created, and states the multiple as value over
  // cost. The "sharpen" estimate-disclosure rides only when estimated (D38).
  const estimated = valueModel.compute(worked(true)).footnote ?? "";
  const real = valueModel.compute(worked(false)).footnote ?? "";
  // Both terms named with figures: $41K from deals, $58K from 384 founder hours.
  for (const footnote of [estimated, real]) {
    assert.match(footnote, /\$41K from deals won/);
    assert.match(footnote, /\$58K from the 384 founder hours/);
    assert.match(footnote, /\$99K/); // the value created the two terms sum to
    assert.match(footnote, /the return multiple is value created over the first-year cost/);
  }
  assert.match(estimated, /sharpen/);
  assert.doesNotMatch(real, /sharpen/);
});

// Metric tiles for the worked example.
//   payback = 23,320 / (99,072 / 12) = 2.82 -> "2.8 mo"
//   hours returned (Expected) = 480 * 1.0 * 0.8 = 384 -> "384 hrs"
//   first-year cost = 23,320 -> "$23K"
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

test("metrics pins First-year cost", () => {
  const m = valueModel.compute(worked()).metrics?.find((x) => x.label === "First-year cost");
  assert.equal(m?.value, "$23K");
});

test("the founder-led page renders no multi-year projection", () => {
  // The five-year cumulative chart is dropped (D59): it belonged to the enterprise
  // model, it contradicted the steady-state headline, and the cheap builder drew it
  // broken. The projection field stays optional on the contract, so it degrades
  // cleanly when absent.
  const result = valueModel.compute(worked());
  assert.equal(result.projection, undefined);
});

test("team_size clamps to 5 so the headcount input never exceeds the founder-led bound", () => {
  // An out-of-range team of 40 must not change the billed-seat math beyond the cap.
  const v = valueModel.validateInputs(
    { team_size: 40, prospects_per_month: 40, avg_deal_value: 12000 },
    false,
  );
  const result = valueModel.compute(v);
  // billedSeats = min(ceil(480/240)=2, clampedTeam 5) = 2, identical to the worked case.
  assert.equal(result.headline.value, "4.3x");
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
  // Every spec field that rides into the research kickoff or the generated page copy
  // must be blocklist-clean (G2), including the hero narrative guidance.
  const haystack =
    `${founderLedSalesVertical.domains.join(" ")} ${founderLedSalesVertical.domainGuidance} ` +
    `${founderLedSalesVertical.executiveTargeting} ${founderLedSalesVertical.inputGuidance} ` +
    `${founderLedSalesVertical.narrativeGuidance ?? ""} ${founderLedSalesVertical.quoteTargeting ?? ""}`;
  assert.doesNotMatch(haystack, /\b(HR|ITSM|CHRO|CIO|ticket|deflection)\b/i);
  assert.doesNotMatch(
    haystack,
    /\b(quota|reps?|ramp(s|ing|ed)?|enablement|procurement|RFP|MQL|SDR|BDR|territory|six-figure|enterprise-grade|account executives?)\b/i,
  );
  // House style: no contractions, no em dashes in the founder-facing guidance.
  // Match only the unambiguous contraction suffixes; possessive 's (founder's,
  // lead's) is valid English and not a contraction, so it stays out of the pattern.
  assert.doesNotMatch(haystack, /\b\w+'(t|re|ve|ll|d|m)\b/i);
  assert.doesNotMatch(haystack, /\b(it|that|there|here|what|who)'s\b/i);
  assert.doesNotMatch(haystack, /—/);
});

test("the founder-led quote targeting sources third-party voices, never the lead", () => {
  const quotes = founderLedSalesVertical.quoteTargeting ?? "";
  assert.notEqual(quotes, "", "founder-led vertical carries a quote-sourcing brief");
  // Third-party voices: investors, peers, industry posts.
  assert.match(quotes, /investor|backer/i);
  assert.match(quotes, /peer|operator|founder/i);
  // Never the lead's own words shown back to the lead (D60).
  assert.match(quotes, /not quote the lead|never the lead/i);
  // D37 rigor is preserved, not relaxed: re-fetch and verify still apply.
  assert.match(quotes, /re-fetch|verif/i);
  // No fabrication path: omit rather than invent when nothing verifies.
  assert.match(quotes, /invent no|return no quotes/i);
});

test("the founder-led narrative grafts the tournament winners without a fabrication path", () => {
  const narrative = founderLedSalesVertical.narrativeGuidance ?? "";
  // The Mirror-First and Shared Scar winners: open on the lead's reality, demote the seller.
  assert.match(narrative, /mirror line/i);
  assert.match(narrative, /first person/i);
  // The rejected investor-quote bets leave no trace: the hero invents nothing and
  // states only researched facts, with an explicit fallback.
  assert.match(narrative, /invent (no|nothing)|never manufacture/i);
  assert.match(narrative, /fallback/i);
});
