import { test } from "node:test";
import assert from "node:assert/strict";
import { salesMarketingVertical } from "../../src/verticals/sales-marketing.ts";
import { assertValueModelContract, ValueModelContractError } from "../../src/verticals/contract.ts";
import { makeProfile } from "../fixtures/profile.ts";

const valueModel = salesMarketingVertical.createValueModel(makeProfile({ vertical: "sales_marketing" }));

function computed(stageBand: string, estimated = false) {
  return valueModel.compute(valueModel.validateInputs({}, estimated, { stage_band: stageBand }));
}

test("validateInputs throws when stage_band is missing", () => {
  assert.throws(
    () => valueModel.validateInputs({}, false, {}),
    /stage_band must be one of pre_seed, seed, series_a/,
  );
});

test("validateInputs throws when stage_band is unknown", () => {
  assert.throws(
    () => valueModel.validateInputs({}, false, { stage_band: "growth" }),
    /stage_band must be one of pre_seed, seed, series_a/,
  );
});

test("validateInputs carries the stage band into context", () => {
  const v = valueModel.validateInputs({}, false, { stage_band: "seed" });
  assert.equal(v.context.stage_band, "seed");
  assert.equal(v.estimated, false);
});

test("compute renders the seed stage time range", () => {
  const result = computed("seed");
  assert.equal(result.headline.value, "~4 to 6 founder-hours reclaimed each week");
});

test("compute renders the series_a stage time range", () => {
  const result = computed("series_a");
  assert.equal(result.headline.value, "~6 to 9 founder-hours reclaimed each week");
});

test("compute fixes the headline label and section title", () => {
  const result = computed("seed");
  assert.equal(result.headline.label, "Founder time reclaimed");
  assert.equal(result.sectionTitle, "What this frees up");
  assert.notEqual(result.mechanism.trim(), "");
});

test("the estimated flag drives the footnote", () => {
  assert.match(computed("seed", true).footnote ?? "", /benchmark/);
  assert.equal(computed("seed", false).footnote, undefined);
});

test("compute satisfies the disclosure contract (estimated=true)", () => {
  assertValueModelContract(computed("seed", true), true);
});

test("compute satisfies the disclosure contract (estimated=false)", () => {
  assertValueModelContract(computed("seed", false), false);
});

test("validateEconomics rejects a missing band_hours shape", () => {
  assert.throws(() => salesMarketingVertical.validateEconomics({}), ValueModelContractError);
});

test("validateEconomics rejects a malformed band_hours pair", () => {
  assert.throws(
    () => salesMarketingVertical.validateEconomics({ band_hours: { seed: [1] } }),
    ValueModelContractError,
  );
});

test("validateEconomics accepts the default-shaped object", () => {
  assert.doesNotThrow(() =>
    salesMarketingVertical.validateEconomics(salesMarketingVertical.defaultEconomics()),
  );
});

test("the spec carries no HR/ITSM/CRO/CMO framing", () => {
  const haystack =
    `${salesMarketingVertical.domains.join(" ")} ${salesMarketingVertical.domainGuidance} ` +
    `${salesMarketingVertical.voiceTargeting} ${salesMarketingVertical.inputGuidance}`;
  assert.doesNotMatch(haystack, /\b(HR|ITSM|CHRO|CIO|CRO|CMO|ticket|deflection)\b/i);
});
