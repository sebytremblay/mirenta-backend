// The vertical seam. A VerticalSpec is the pluggable unit the data model
// anticipated (D20: "generic core plus a pluggable domain extension"): it carries
// everything the generic pipeline needs to research and render for one market
// segment, held as data rather than hardcoded into the core. The MVP registers
// one spec (employee-service); a new vertical is a data-only add.
//
// The generic core stays vertical-neutral and reads from the selected spec:
// - the Research Agent's per-lead kickoff injects domains, executive targeting,
//   and value-input guidance from the spec (the system prompt stays generic and
//   cache-stable, since the persistent Managed Agent freezes it);
// - the Website Builder renders the spec's computed ValueResult;
// - validateResearch enforces the spec's value-input contract in code.

// The factory signature (createValueModel) types its argument as ProductProfile.
// The dependency runs one way: verticals reads the entity shape, entities imports
// nothing from verticals. A type-only import erases at compile time, so it raises
// no runtime cycle even when Phase 2 adds an economics field to the profile.
// Re-exported so a consumer can reach the type through the seam module.
import type { ProductProfile } from "../domain/entities.ts";
export type { ProductProfile };

// The validated, vertical-typed inputs the value model computes from. The
// generic research payload carries value_inputs as an open numeric map; each
// spec's validateInputs narrows that map to the keys its compute needs.
//
// DESIGN NOTE (D53): value_inputs is numeric-only by design. Categorical inputs
// (region, segment, tier) should be encoded as numeric codes and decoded in
// validateInputs. Example:
//
//   validateInputs(raw, estimated) {
//     const regionCode = raw.region ?? 1; // 1=NA, 2=EU, 3=APAC
//     const region = ["NA", "EU", "APAC"][regionCode - 1];
//     return { values: { region }, estimated };
//   }
//
// This preserves the frozen emit_research schema without cache invalidation.
export interface ValidatedInputs {
  values: Record<string, number>;
  estimated: boolean;
}

// One adoption/sensitivity scenario the page renders as a stat card. Labels are
// vertical-supplied so the card reads correctly whether the value is savings,
// revenue uplift, time recovered, or risk avoided.
export interface ValueScenario {
  name: string; // "conservative" | "expected" | "aggressive", or vertical-specific
  primaryValue: string; // formatted headline figure for the card, e.g. "$1.2M"
  primaryLabel: string; // what the figure means, e.g. "Net Annual Savings"
  secondary?: string; // optional second metric, e.g. "320% ROI"
}

// One headline metric tile in the business case (e.g. "Expected ROI" -> "156%").
// Both fields are display-ready strings; the value model formats every figure so
// the builder renders verbatim and the page validator can confirm presence.
export interface ValueMetric {
  label: string; // what the figure means, e.g. "Payback period"
  value: string; // the formatted figure, e.g. "4.9 mo", "$10.1M", "156%"
}

// A cumulative projection the builder draws as a chart. Each point carries the
// raw numeric `value` (so the builder can scale the chart geometry) and the
// pre-formatted `display` string (so labels render verbatim and stay auditable).
export interface ValueProjection {
  label: string; // chart caption, e.g. "Cumulative net cash flow"
  unit: string; // the series unit, e.g. "USD"
  series: { period: string; value: number; display: string }[];
}

// The vertical-neutral business-value block the builder renders. A value model
// computes this deterministically; the model never invents the numbers. The
// optional `metrics` and `projection` let a vertical opt into a richer ROI
// section (headline tiles and a cumulative chart) without changing the seam; a
// vertical that omits them still renders the headline and scenario cards.
export interface ValueResult {
  sectionTitle: string; // e.g. "Business Value"
  headline: { label: string; value: string };
  scenarios: ValueScenario[];
  footnote?: string;
  metrics?: ValueMetric[];
  projection?: ValueProjection;
}

// The pluggable value/ROI model for one vertical (replaces the hardcoded
// computeRoi). Each vertical owns its inputs, its formula, and its render labels,
// so the generic core makes no support-deflection assumption.
export interface ValueModel {
  // Phase 4 prompt fragment: names the numeric value_inputs keys the agent must
  // gather for this vertical and how to estimate them when they are not public.
  inputGuidance: string;
  // Narrow the generic numeric map to this vertical's typed inputs. Throws
  // ResearchSchemaError when a required key is missing, so a malformed research
  // object fails the validation gate rather than reaching compute.
  validateInputs(raw: Record<string, number>, estimated: boolean): ValidatedInputs;
  // Deterministic value computation. No model involvement.
  compute(inputs: ValidatedInputs): ValueResult;
}

// Economics configuration per customer (pricing and effectiveness assumptions).
// Moved from hardcoded vertical constants to support multi-customer use of the
// same vertical with different product economics (Concern #1).
export interface VerticalEconomics {
  annual_license: number; // annual licensing cost in USD
  implementation_fee: number; // one-time implementation cost in USD
  scenarios: Array<{
    name: string; // scenario label, e.g. "Conservative"
    effectiveness: Record<string, number>; // metric-specific effectiveness rates
  }>;
  adoption_curve?: number[]; // optional: 5-year adoption ramp (defaults to [0.5, 0.8, 1.0, 1.0, 1.0])
}

// A bound value model with customer-specific economics baked in. The factory
// pattern (createValueModel) returns this instead of a bare ValueModel, so
// compute() stays pure while per-customer configuration flows through.
export interface BoundValueModel extends ValueModel {
  economics: VerticalEconomics; // expose for introspection and tests
}

export interface VerticalSpec {
  id: string; // stable identifier persisted on the profile and the research object
  label: string; // human-readable name
  domains: string[]; // the domain set the page organizes priorities around
  domainGuidance: string; // Research Agent Phase 1 fragment (what to surface per domain)
  executiveTargeting: string; // Research Agent Phase 2 fragment (which leaders to find)
  defaultAccentColor: string; // page accent when the seller supplies none
  // Phase 4 prompt fragment: names the numeric value_inputs keys the research agent
  // must gather and how to estimate them when they are not public. Exposed directly
  // on the spec (not on the bound value model) so the research agent can inject it
  // into the kickoff without needing a product profile.
  inputGuidance: string;
  // Validate research value_inputs (used by validateResearch early gate, independent
  // of economics). Throws when required keys are missing. Exposed directly on the
  // spec so validateResearch can check the research object without creating a bound
  // value model or needing a product profile.
  validateInputs(raw: Record<string, number>, estimated: boolean): ValidatedInputs;
  // Factory that returns a value model bound to the customer's economics. Phase 1
  // always returns default economics; Phase 2 reads profile.economics when present.
  createValueModel(profile: ProductProfile): BoundValueModel;
  // Default economics when profile.economics is null or absent. Verticals export
  // this so tests can introspect the defaults without creating a full profile.
  defaultEconomics(): VerticalEconomics;
  // Validate a raw economics object against this vertical's shape and against the
  // D38/D49 disclosure policy (scenario count, names, and the effectiveness keys
  // compute reads). Throws ValueModelContractError on any violation. saveProfile
  // calls this so a misconfigured economics object fails at save (mapped to a 400
  // the seller can correct) rather than reaching the worker; createValueModel
  // calls it again at build as a defense-in-depth guard for rows that bypass save.
  validateEconomics(raw: unknown): VerticalEconomics;
}

