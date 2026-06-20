// The vertical registry. The generic pipeline resolves the active VerticalSpec
// by id at runtime: the id persists on the product profile (the customer's
// declared vertical) and on the research object. Registering a new vertical is a
// data-only add here, with no change to the generic core (D2, D20).

import { employeeServiceVertical } from "./employee-service.ts";
import type { VerticalSpec } from "./types.ts";

export type { ValidatedInputs, ValueModel, ValueResult, ValueScenario, VerticalSpec } from "./types.ts";

// The vertical a profile defaults to when none is set. The MVP ships the
// employee-service vertical, so the profile column and the schema migration both
// default to this id.
export const DEFAULT_VERTICAL_ID = employeeServiceVertical.id;

export const VERTICALS: Record<string, VerticalSpec> = {
  [employeeServiceVertical.id]: employeeServiceVertical,
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
