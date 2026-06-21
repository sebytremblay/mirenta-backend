// Shared ProductProfile fixture for unit tests. The full row carries several
// nullable columns that exist only to satisfy the type; hand-writing the whole
// literal in every test obscures the one or two fields a test actually varies
// (usually vertical or economics) and forces a fan-out edit when the row grows a
// required column. makeProfile collapses that to one source. Mirrors the local
// profile() factories already in precondition.test.ts and brand-tokens.test.ts.

import type { ProductProfile } from "../../src/domain/entities.ts";

export function makeProfile(overrides: Partial<ProductProfile> = {}): ProductProfile {
  return {
    org_id: "test-org",
    company_name: "Test Corp",
    product_name: "Test Product",
    value_prop: "Test value",
    positioning: null,
    proof_points: null,
    cta_text: null,
    brand: null,
    vertical: "salesforce_employee_service",
    economics: null,
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}
