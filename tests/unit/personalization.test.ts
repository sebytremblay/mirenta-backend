import { test } from "node:test";
import assert from "node:assert/strict";
import { saveProfile, ProfileValidationError, missingRequiredFields } from "../../src/services/personalization.ts";

const validRequired = {
  company_name: "Salesforce",
  product_name: "Agentforce",
  value_prop: "Deflect support volume",
};

test("saveProfile rejects a missing required field before the DB call", async () => {
  await assert.rejects(
    () => saveProfile("test-org", { company_name: "", product_name: "P", value_prop: "V" }),
    (err: unknown) =>
      err instanceof ProfileValidationError && err.missing.includes("company_name"),
  );
});

test("saveProfile reports every missing required field at once", async () => {
  await assert.rejects(
    () => saveProfile("test-org", {}),
    (err: unknown) =>
      err instanceof ProfileValidationError &&
      err.missing.includes("company_name") &&
      err.missing.includes("product_name") &&
      err.missing.includes("value_prop"),
  );
});

test("missingRequiredFields reports a null profile as missing every field", () => {
  assert.deepEqual(missingRequiredFields(null), [
    "company_name",
    "product_name",
    "value_prop",
  ]);
});

test("missingRequiredFields treats whitespace-only values as missing", () => {
  assert.deepEqual(
    missingRequiredFields({ ...validRequired, value_prop: "   " }),
    ["value_prop"],
  );
});
