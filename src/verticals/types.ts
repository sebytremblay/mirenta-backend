import type { ProductProfile } from "../domain/entities.ts";
export type { ProductProfile };

export interface ValidatedInputs {
  values: Record<string, number>;
  estimated: boolean;
}

export interface ValueScenario {
  name: string;
  primaryValue: string;
  primaryLabel: string;
  secondary?: string;
}

export interface ValueMetric {
  label: string;
  value: string;
}

// `value` carries the raw number so the builder can scale the chart geometry;
// `display` carries the pre-formatted string so labels stay auditable.
export interface ValueProjection {
  label: string;
  unit: string;
  series: { period: string; value: number; display: string }[];
}

export interface ValueResult {
  sectionTitle: string;
  headline: { label: string; value: string };
  scenarios: ValueScenario[];
  footnote?: string;
  metrics?: ValueMetric[];
  projection?: ValueProjection;
}

export interface ValueModel {
  inputGuidance: string;
  validateInputs(raw: Record<string, number>, estimated: boolean): ValidatedInputs;
  compute(inputs: ValidatedInputs): ValueResult;
}

export interface VerticalEconomics {
  annual_license: number;
  implementation_fee: number;
  scenarios: Array<{
    name: string;
    effectiveness: Record<string, number>;
  }>;
  adoption_curve?: number[];
}

export interface BoundValueModel extends ValueModel {
  economics: VerticalEconomics;
}

export interface VerticalSpec {
  id: string;
  label: string;
  domains: string[];
  domainGuidance: string;
  executiveTargeting: string;
  defaultAccentColor: string;
  inputGuidance: string;
  validateInputs(raw: Record<string, number>, estimated: boolean): ValidatedInputs;
  createValueModel(profile: ProductProfile): BoundValueModel;
  defaultEconomics(): VerticalEconomics;
  validateEconomics(raw: unknown): VerticalEconomics;
}

