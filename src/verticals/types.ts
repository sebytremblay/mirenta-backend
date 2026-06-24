import type { ProductProfile } from "../domain/entities.ts";
export type { ProductProfile };

export interface ValidatedInputs {
  values: Record<string, number>;
  // Categorical signals the vertical narrowed from research.extension.context.
  context: Record<string, string>;
  estimated: boolean;
}

// The founder value render: one honest expression plus the one-sentence
// mechanism that produces it, footnoted as estimated when inputs are inferred.
// `headline.value` is a free string the vertical composes (a range, a rate, or
// a qualitative claim); the engine renders it verbatim and never parses it.
export interface ValueResult {
  sectionTitle: string;
  headline: { label: string; value: string };
  mechanism: string; // the one-sentence "why", required
  footnote?: string; // estimated disclosure
}

export interface ValueModel {
  inputGuidance: string;
  validateInputs(
    raw: Record<string, number>,
    estimated: boolean,
    context?: Record<string, string>,
  ): ValidatedInputs;
  compute(inputs: ValidatedInputs): ValueResult;
}

// VerticalEconomics stays opaque to the engine. Each vertical owns its own
// economics shape and its own validateEconomics; the shared contract enforces
// only the no-fabrication invariants on the rendered result, never these fields.
export type VerticalEconomics = Record<string, unknown>;

export interface BoundValueModel extends ValueModel {
  economics: VerticalEconomics;
}

export interface VerticalSpec {
  id: string;
  label: string;
  domains: string[];
  domainGuidance: string;
  voiceTargeting: string;
  defaultAccentColor: string;
  inputGuidance: string;
  validateInputs(
    raw: Record<string, number>,
    estimated: boolean,
    context?: Record<string, string>,
  ): ValidatedInputs;
  createValueModel(profile: ProductProfile): BoundValueModel;
  defaultEconomics(): VerticalEconomics;
  validateEconomics(raw: unknown): VerticalEconomics;
}
