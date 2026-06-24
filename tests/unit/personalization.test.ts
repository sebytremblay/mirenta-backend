import { test } from "node:test";
import assert from "node:assert/strict";
import { saveProfile, ProfileValidationError } from "../../src/services/personalization.ts";

const validRequired = {
  company_name: "Salesforce",
  product_name: "Agentforce",
  value_prop: "Deflect support volume",
};

test("saveProfile rejects malformed employee_service economics before the DB call", async () => {
  await assert.rejects(
    () =>
      saveProfile("test-org", {
        ...validRequired,
        vertical: "salesforce_employee_service",
        economics: { savings_basis_points: -1 },
      }),
    (err: unknown) =>
      err instanceof ProfileValidationError &&
      err.missing.some((m) => /economics:.*savings_basis_points/.test(m)),
  );
});

test("saveProfile rejects employee_service economics missing savings_basis_points", async () => {
  await assert.rejects(
    () =>
      saveProfile("test-org", {
        ...validRequired,
        vertical: "salesforce_employee_service",
        economics: {},
      }),
    (err: unknown) =>
      err instanceof ProfileValidationError &&
      err.missing.some((m) => /economics:.*savings_basis_points/.test(m)),
  );
});

test("saveProfile rejects malformed sales_marketing economics before the DB call", async () => {
  await assert.rejects(
    () =>
      saveProfile("test-org", {
        ...validRequired,
        vertical: "sales_marketing",
        economics: { band_hours: { seed: [1] } },
      }),
    (err: unknown) =>
      err instanceof ProfileValidationError &&
      err.missing.some((m) => /economics:.*band_hours/.test(m)),
  );
});

test("an absent vertical falls back to generic, which accepts any economics object", async () => {
  await assert.rejects(
    () => saveProfile("test-org", { ...validRequired, economics: { anything: true } }),
    (err: unknown) => !(err instanceof ProfileValidationError),
  );
});

test("saveProfile rejects a required field before reaching the economics gate", async () => {
  await assert.rejects(
    () => saveProfile("test-org", { company_name: "", product_name: "P", value_prop: "V" }),
    (err: unknown) =>
      err instanceof ProfileValidationError && err.missing.includes("company_name"),
  );
});
