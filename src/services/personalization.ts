import {
  getProductProfile as dbGetProductProfile,
  upsertProductProfile as dbUpsertProductProfile,
} from "../db/client.ts";
import { REQUIRED_PROFILE_FIELDS, type ProductProfile } from "../domain/entities.ts";
import type { VerticalEconomics } from "../verticals/types.ts";
import { DEFAULT_VERTICAL_ID, getVertical, isKnownVertical } from "../verticals/index.ts";
import { ValueModelContractError } from "../verticals/contract.ts";

export interface ProfileInput {
  company_name?: string;
  product_name?: string;
  value_prop?: string;
  positioning?: string;
  proof_points?: { claim: string; source?: string }[];
  cta_text?: string;
  brand?: { primary_color?: string; logo_url?: string; [key: string]: unknown };
  vertical?: string;
  economics?: VerticalEconomics;
}

export class ProfileValidationError extends Error {
  readonly missing: string[];
  constructor(missing: string[]) {
    super(`product profile missing required fields: ${missing.join(", ")}`);
    this.name = "ProfileValidationError";
    this.missing = missing;
  }
}

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

export async function isProfileComplete(orgId: string): Promise<boolean> {
  const profile = await dbGetProductProfile(orgId);
  return missingRequiredFields(profile).length === 0;
}

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

  const verticalId = input.vertical?.trim() || DEFAULT_VERTICAL_ID;
  if (!isKnownVertical(verticalId)) {
    throw new ProfileValidationError([`vertical: unknown id "${verticalId}"`]);
  }

  let economics: VerticalEconomics | null = null;
  if (input.economics != null) {
    try {
      economics = getVertical(verticalId).validateEconomics(input.economics);
    } catch (err) {
      if (err instanceof ValueModelContractError) {
        throw new ProfileValidationError([`economics: ${err.message}`]);
      }
      throw err;
    }
  }

  return dbUpsertProductProfile({
    org_id: orgId,
    ...required,
    positioning: input.positioning ?? null,
    proof_points: input.proof_points ?? null,
    cta_text: input.cta_text ?? null,
    brand: input.brand ?? null,
    vertical: verticalId,
    economics,
  });
}
