---
name: review-fixes
description: Adversarial review findings on the founder-led model and how each was resolved
metadata:
  type: project
---

An independent adversarial code review (code-review subagent) of the founder_led_sales value
model confirmed the arithmetic is correct and G1 holds for every input the real pipeline delivers
(it ran typecheck, the full suite, an independent 51,744-point sweep including pathological inputs,
and hand-recomputed the worked example and three corners). Findings and resolutions:

- **FL-1 (major), FIXED:** `clamp(NaN)` returned NaN, which would render a "NaNx" headline. The
  upstream `toNumericMap` (src/domain/research.ts) already drops non-finite values before compute,
  so it was unreachable in production, but the file header promises G1 holds "by construction inside
  compute" for any input. Made `clamp` total: `if (!Number.isFinite(n)) return lo;` -> conservative
  low bound. Honors the contract independent of the upstream filter.
- **FL-2 (major), FIXED:** the G1 harness swept only finite in-band inputs, so it could not catch
  FL-1. Added NaN/Infinity/negative corners to the grid (now 134ms, ~330k points). PROVEN closed-loop:
  reverting the clamp fix makes the harness fail on "NaNx"; the fix restores green.
- **FL-4 (minor), FIXED:** the scenario card and metric tile said "Value in year one" but compute the
  steady-state annual net (gross - effectiveLicense, no ramp, no implementation fee), while the
  projection's "Year 1" point is ramped and absorbs the fee. Two different "year one" numbers on one
  page. Relabeled both to "Annual value"; headline stays the first-year MULTIPLE, projection stays
  cumulative. Each figure now honestly named (matters for G3).
- **FL-7 (nit), FIXED:** verticals.test.ts now asserts founder_led_sales is registered.
- **FL-3, FL-5, FL-6 (nits):** the `firstYearCost > 0` guard is unreachable for valid input
  (seatAnnual >= 600 always); clamp directions all verified conservative; the stale "9 + 0.006"
  breadcrumb is harmless. Left as-is; the clamp fix neutralizes the only NaN path FL-3 worried about.
- **FL-8:** D59 is cited in code but not yet in DECISIONS.md. That is T10 (G4), still open.

See [[founder-led-roi-model]] and [[baseline-green]].
