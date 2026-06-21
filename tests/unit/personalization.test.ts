// Unit tests for the Personalization Service save-time gates. saveProfile
// rejects a malformed profile before the DB call, so these run without a live
// database: each case throws on a validation path that precedes the upsert.
// The economics gate (Phase 2) is the focus: a bad economics object must fail at
// save as a ProfileValidationError (mapped to HTTP 400) so the seller corrects it
// before any lead runs, rather than failing permanently at the worker's build.

import { test } from "node:test";
import assert from "node:assert/strict";
import { saveProfile, ProfileValidationError } from "../../src/services/personalization.ts";
import type { VerticalEconomics } from "../../src/verticals/types.ts";

const validRequired = {
  company_name: "Salesforce",
  product_name: "Agentforce",
  value_prop: "Deflect support volume",
};

const goodEconomics: VerticalEconomics = {
  annual_license: 2_000_000,
  implementation_fee: 300_000,
  scenarios: [
    { name: "Conservative", effectiveness: { itDeflection: 0.45, hrDeflection: 0.5 } },
    { name: "Expected", effectiveness: { itDeflection: 0.6, hrDeflection: 0.65 } },
    { name: "Aggressive", effectiveness: { itDeflection: 0.75, hrDeflection: 0.8 } },
  ],
};

test("saveProfile rejects economics with the wrong scenario count before the DB call", async () => {
  await assert.rejects(
    () =>
      saveProfile("test-org", {
        ...validRequired,
        economics: { ...goodEconomics, scenarios: goodEconomics.scenarios.slice(0, 2) },
      }),
    (err: unknown) =>
      err instanceof ProfileValidationError &&
      err.missing.some((m) => /economics:.*exactly 3 scenarios/.test(m)),
  );
});

test("saveProfile rejects economics with disallowed scenario names", async () => {
  await assert.rejects(
    () =>
      saveProfile("test-org", {
        ...validRequired,
        economics: {
          ...goodEconomics,
          scenarios: [
            { name: "Low", effectiveness: { itDeflection: 0.45, hrDeflection: 0.5 } },
            { name: "Mid", effectiveness: { itDeflection: 0.6, hrDeflection: 0.65 } },
            { name: "High", effectiveness: { itDeflection: 0.75, hrDeflection: 0.8 } },
          ],
        },
      }),
    (err: unknown) =>
      err instanceof ProfileValidationError &&
      err.missing.some((m) => /economics:.*Conservative/.test(m)),
  );
});

test("saveProfile rejects economics with a typo'd effectiveness key", async () => {
  await assert.rejects(
    () =>
      saveProfile("test-org", {
        ...validRequired,
        economics: {
          ...goodEconomics,
          scenarios: [
            { name: "Conservative", effectiveness: { itDelfection: 0.45, hrDeflection: 0.5 } },
            { name: "Expected", effectiveness: { itDeflection: 0.6, hrDeflection: 0.65 } },
            { name: "Aggressive", effectiveness: { itDeflection: 0.75, hrDeflection: 0.8 } },
          ],
        },
      }),
    (err: unknown) =>
      err instanceof ProfileValidationError &&
      err.missing.some((m) => /economics:.*itDeflection/.test(m)),
  );
});

test("saveProfile rejects a required field before reaching the economics gate", async () => {
  await assert.rejects(
    () => saveProfile("test-org", { company_name: "", product_name: "P", value_prop: "V" }),
    (err: unknown) =>
      err instanceof ProfileValidationError && err.missing.includes("company_name"),
  );
});
