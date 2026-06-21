// Shared financial projection engine for the dollar-value verticals. Every
// vertical whose value model produces a monetary business case (employee-service
// support deflection, sales-marketing pipeline uplift) runs the same projection
// once it knows the gross annual value each scenario drives: net against the
// license, ROI, expected-case payback, an adoption-ramp cash flow, the cumulative
// series the page charts, and an NPV. Only two things differ between verticals,
// and this engine takes both as parameters:
//   - grossFor: turns one scenario's effectiveness map into its gross annual value
//     (the vertical captures its own cost pools or revenue drivers in the closure).
//   - labels: the display strings the rendered ValueResult carries.
//
// The qualitative generic vertical invents no figures and does NOT use this engine.
//
// The disclosure policy (D38/D49: exactly three scenarios named in order, a
// footnote when estimated) is enforced separately by contract.ts; this engine only
// computes figures from already-validated economics.

import { formatDollars } from "../domain/format.ts";
import type { ValidatedInputs, ValueResult, VerticalEconomics } from "./types.ts";

// Default 5-year adoption ramp. Each vertical's defaultEconomics populates it and
// this engine falls back to it when an economics object omits the curve. One
// source so a deliberate change to the ramp edits one literal.
export const DEFAULT_ADOPTION_CURVE = [0.5, 0.8, 1.0, 1.0, 1.0];

// Discount rate for the NPV metric. The page labels it "NPV at 8 percent".
const DISCOUNT_RATE = 0.08;

function round(n: number): number {
  return Math.round(n);
}

// The vertical-specific display strings the projection carries. The math is
// identical across verticals; only the wording of savings vs revenue differs.
export interface FinancialLabels {
  // Per-scenario card label, e.g. "Net Annual Savings".
  primaryLabel: string;
  // Headline label, e.g. "Expected net annual savings".
  headlineLabel: string;
  // The cumulative metric tile label, e.g. "5-year net savings".
  fiveYearLabel: string;
  // The projection chart caption, e.g. "Cumulative net cash flow".
  projectionLabel: string;
  // The footnote rendered when inputs are estimated.
  estimatedFootnote: string;
}

// Project the full monetary business case from the economics and a gross-value
// function. Returns the vertical-neutral ValueResult the builder renders verbatim.
export function projectFinancials(
  economics: VerticalEconomics,
  inputs: ValidatedInputs,
  grossFor: (effectiveness: Record<string, number>) => number,
  labels: FinancialLabels,
): ValueResult {
  const firstYearCost = economics.annual_license + economics.implementation_fee;

  // Each scenario: gross value drives net against the license, and ROI against
  // the full first-year cost.
  const scenarios = economics.scenarios.map((s) => {
    const gross = grossFor(s.effectiveness);
    const net = gross - economics.annual_license;
    const roiPercent = firstYearCost > 0 ? (net / firstYearCost) * 100 : 0;
    return {
      name: s.name,
      primaryValue: formatDollars(round(net)),
      primaryLabel: labels.primaryLabel,
      secondary: `${round(roiPercent)}% ROI`,
    };
  });

  // The expected case (scenario index 1, per the D49 ordering) drives the
  // headline, payback, projection, and NPV.
  const expectedGross = grossFor(economics.scenarios[1]!.effectiveness);
  const expectedNet = round(expectedGross - economics.annual_license);

  // Payback: total first-year investment divided by monthly gross value. Guard
  // against a zero driver: expectedGross of 0 produces Infinity otherwise.
  const paybackValue =
    expectedGross > 0 ? `${(firstYearCost / (expectedGross / 12)).toFixed(1)} mo` : "n/a";

  // Annual cash flows follow the adoption ramp; year 1 absorbs the implementation fee.
  const adoption = economics.adoption_curve ?? DEFAULT_ADOPTION_CURVE;
  const annualCashFlows = adoption.map((ramp, i) => {
    const yearNumber = i + 1;
    return (
      ramp * expectedGross -
      economics.annual_license -
      (yearNumber === 1 ? economics.implementation_fee : 0)
    );
  });

  // Cumulative series: each point sums all flows up to and including that year.
  let runningTotal = 0;
  const series = annualCashFlows.map((flow, i) => {
    runningTotal += flow;
    const rounded = round(runningTotal);
    return {
      period: `Year ${i + 1}`,
      value: rounded,
      display: formatDollars(rounded),
    };
  });

  const cumulative5 = runningTotal;

  // NPV: discount each year's cash flow back to present value, then round.
  const npv = round(
    annualCashFlows.reduce((sum, flow, i) => sum + flow / (1 + DISCOUNT_RATE) ** (i + 1), 0),
  );

  return {
    sectionTitle: "Business Value",
    headline: { label: labels.headlineLabel, value: formatDollars(expectedNet) },
    scenarios,
    footnote: inputs.estimated ? labels.estimatedFootnote : undefined,
    metrics: [
      { label: "Expected ROI", value: `${round((expectedNet / firstYearCost) * 100)}%` },
      { label: "Payback period", value: paybackValue },
      { label: labels.fiveYearLabel, value: formatDollars(round(cumulative5)) },
      { label: "NPV at 8 percent", value: formatDollars(npv) },
    ],
    projection: {
      label: labels.projectionLabel,
      unit: "USD",
      series,
    },
  };
}
