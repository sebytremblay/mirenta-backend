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

// Economics validation is vertical-specific, so these cases declare the
// employee-service vertical explicitly: its contract requires the itDeflection
// and hrDeflection keys these objects carry. The default vertical is now the
// neutral generic spec, which requires no effectiveness key, so an absent vertical
// no longer exercises this contract (see the fallback test below).
const employeeService = { vertical: "salesforce_employee_service" } as const;

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
        ...employeeService,
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
        ...employeeService,
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
        ...employeeService,
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

test("an absent vertical falls back to generic, which requires no effectiveness key", async () => {
  // Economics valid under the generic contract (three correctly-named scenarios,
  // empty effectiveness) but invalid under employee-service (missing itDeflection).
  // Under the former employee-service default this rejected as a
  // ProfileValidationError; under the generic default the economics gate passes
  // and the call proceeds to the DB. The DB is not live here, so the call still
  // throws, but NOT as a ProfileValidationError. That distinguishes the fallback.
  const genericEconomics: VerticalEconomics = {
    annual_license: 0,
    implementation_fee: 0,
    scenarios: [
      { name: "Conservative", effectiveness: {} },
      { name: "Expected", effectiveness: {} },
      { name: "Aggressive", effectiveness: {} },
    ],
  };
  await assert.rejects(
    () => saveProfile("test-org", { ...validRequired, economics: genericEconomics }),
    (err: unknown) => !(err instanceof ProfileValidationError),
  );
});

test("saveProfile validates economics against the sales_marketing contract when declared", async () => {
  // A typo'd uplift key fails the sales_marketing contract at save, proving the
  // declared vertical resolves and gates before the DB call.
  await assert.rejects(
    () =>
      saveProfile("test-org", {
        ...validRequired,
        vertical: "sales_marketing",
        economics: {
          annual_license: 150_000,
          implementation_fee: 30_000,
          scenarios: [
            { name: "Conservative", effectiveness: { meting_uplift: 0.1 } },
            { name: "Expected", effectiveness: { meeting_uplift: 0.2 } },
            { name: "Aggressive", effectiveness: { meeting_uplift: 0.35 } },
          ],
        },
      }),
    (err: unknown) =>
      err instanceof ProfileValidationError &&
      err.missing.some((m) => /economics:.*meeting_uplift/.test(m)),
  );
});

test("saveProfile rejects a required field before reaching the economics gate", async () => {
  await assert.rejects(
    () => saveProfile("test-org", { company_name: "", product_name: "P", value_prop: "V" }),
    (err: unknown) =>
      err instanceof ProfileValidationError && err.missing.includes("company_name"),
  );
});
