// Unit tests for the precondition gate (D14). The Lead Service rejects a
// submission when any required profile field is null or blank; this pins which
// fields gate and how blanks are treated.

import { test } from "node:test";
import assert from "node:assert/strict";
import { missingRequiredFields } from "../../src/services/personalization.ts";
import type { ProductProfile } from "../../src/domain/entities.ts";

function profile(over: Partial<ProductProfile> = {}): ProductProfile {
  return {
    org_id: "org",
    company_name: "Salesforce",
    product_name: "Agentforce",
    value_prop: "Deflect support volume",
    positioning: null,
    proof_points: null,
    cta_text: null,
    brand: null,
    vertical: "salesforce_employee_service",
    economics: null,
    created_at: "",
    updated_at: "",
    ...over,
  };
}

test("a complete profile has no missing fields", () => {
  assert.deepEqual(missingRequiredFields(profile()), []);
});

test("a null profile reports all required fields missing", () => {
  assert.deepEqual(missingRequiredFields(null), [
    "company_name",
    "product_name",
    "value_prop",
  ]);
});

test("a blank required field counts as missing", () => {
  assert.deepEqual(missingRequiredFields(profile({ value_prop: "   " })), ["value_prop"]);
});

test("optional fields do not gate", () => {
  assert.deepEqual(missingRequiredFields(profile({ positioning: null, cta_text: null })), []);
});

test("multiple blanks all report", () => {
  const missing = missingRequiredFields(
    profile({ company_name: "", product_name: "" }),
  );
  assert.deepEqual(missing, ["company_name", "product_name"]);
});
