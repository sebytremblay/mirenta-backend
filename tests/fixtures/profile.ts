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
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}
