// The vertical registry. The generic pipeline resolves the active VerticalSpec
// by id at runtime: the id persists on the product profile (the customer's
// declared vertical) and on the research object. Registering a new vertical is a
// data-only add here, with no change to the generic core (D2, D20).

import { genericVertical } from "./generic.ts";
import { employeeServiceVertical } from "./employee-service.ts";
import { salesMarketingVertical } from "./sales-marketing.ts";
import type { VerticalSpec } from "./types.ts";

export type {
  BoundValueModel,
  ValidatedInputs,
  ValueMetric,
  ValueModel,
  ValueProjection,
  ValueResult,
  ValueScenario,
  VerticalEconomics,
  VerticalSpec,
} from "./types.ts";

// The vertical a profile defaults to when none is set. The neutral generic
// vertical is the fallback so an un-configured profile researches and renders
// through a vertical-neutral lens rather than inheriting another vertical's
// industry assumptions (the HR/ITSM leak this closes). Migration 0009 repoints
// the DB column default to match. A customer that sells into a specific vertical
// declares it explicitly (for example "salesforce_employee_service").
export const DEFAULT_VERTICAL_ID = genericVertical.id;

export const VERTICALS: Record<string, VerticalSpec> = {
  [genericVertical.id]: genericVertical,
  [employeeServiceVertical.id]: employeeServiceVertical,
  [salesMarketingVertical.id]: salesMarketingVertical,
};

export function isKnownVertical(id: string): boolean {
  return Object.prototype.hasOwnProperty.call(VERTICALS, id);
}

// Resolve a spec by id. Throws on an unknown id so a misconfigured profile fails
// loudly at the stage boundary rather than rendering a page with no vertical.
export function getVertical(id: string): VerticalSpec {
  const spec = VERTICALS[id];
  if (!spec) {
    throw new Error(`unknown vertical: ${id} (known: ${Object.keys(VERTICALS).join(", ")})`);
  }
  return spec;
}
