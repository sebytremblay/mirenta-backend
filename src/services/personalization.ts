// Personalization Service. Owns the product profile (mvp-pipeline-architecture
// Service Topology). The seller completes it during onboarding, before any lead.
// The Website Builder reads it and the Lead Service gates on it.

import {
  getProductProfile as dbGetProductProfile,
  upsertProductProfile as dbUpsertProductProfile,
} from "../db/client.ts";
import { REQUIRED_PROFILE_FIELDS, type ProductProfile } from "../domain/entities.ts";

export interface ProfileInput {
  company_name?: string;
  product_name?: string;
  value_prop?: string;
  positioning?: string;
  proof_points?: { claim: string; source?: string }[];
  cta_text?: string;
  brand?: { primary_color?: string; logo_url?: string; [key: string]: unknown };
}

export class ProfileValidationError extends Error {
  readonly missing: string[];
  constructor(missing: string[]) {
    super(`product profile missing required fields: ${missing.join(", ")}`);
    this.name = "ProfileValidationError";
    this.missing = missing;
  }
}

// Which required columns are null or blank on a profile-shaped object.
export function missingRequiredFields(
  profile: Pick<ProductProfile, "company_name" | "product_name" | "value_prop"> | null,
): string[] {
  if (!profile) return [...REQUIRED_PROFILE_FIELDS];
  return REQUIRED_PROFILE_FIELDS.filter((field) => {
    const value = profile[field];
    return value === null || value === undefined || String(value).trim() === "";
  });
}

export async function getProfile(orgId: string): Promise<ProductProfile | null> {
  return dbGetProductProfile(orgId);
}

// True when every required column is non-null. The Lead Service calls this gate
// at submission time, before spending any research or build cost.
export async function isProfileComplete(orgId: string): Promise<boolean> {
  const profile = await dbGetProductProfile(orgId);
  return missingRequiredFields(profile).length === 0;
}

// Upsert the profile. Rejects when a required field is blank, so the gate the
// Lead Service relies on stays meaningful. Optional fields pass through.
export async function saveProfile(
  orgId: string,
  input: ProfileInput,
): Promise<ProductProfile> {
  const required = {
    company_name: input.company_name?.trim() ?? "",
    product_name: input.product_name?.trim() ?? "",
    value_prop: input.value_prop?.trim() ?? "",
  };
  const missing = REQUIRED_PROFILE_FIELDS.filter((f) => required[f] === "");
  if (missing.length > 0) throw new ProfileValidationError(missing);

  return dbUpsertProductProfile({
    org_id: orgId,
    ...required,
    positioning: input.positioning ?? null,
    proof_points: input.proof_points ?? null,
    cta_text: input.cta_text ?? null,
    brand: input.brand ?? null,
  });
}
