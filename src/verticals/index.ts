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

export const DEFAULT_VERTICAL_ID = genericVertical.id;

export const VERTICALS: Record<string, VerticalSpec> = {
  [genericVertical.id]: genericVertical,
  [employeeServiceVertical.id]: employeeServiceVertical,
  [salesMarketingVertical.id]: salesMarketingVertical,
};

export function isKnownVertical(id: string): boolean {
  return Object.prototype.hasOwnProperty.call(VERTICALS, id);
}

export function getVertical(id: string): VerticalSpec {
  const spec = VERTICALS[id];
  if (!spec) {
    throw new Error(`unknown vertical: ${id} (known: ${Object.keys(VERTICALS).join(", ")})`);
  }
  return spec;
}
