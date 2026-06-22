---
name: g3-iterations
description: The G3 founder-review iteration history for the founder-led one-pager and the structural fixes each failure drove
metadata:
  type: project
---

T9 (G3 production gate) runs a cost-disciplined faithful loop: emit the GENUINE assembled
Builder prompt deterministically (scripts/emit-founder-sample-prompt.ts, zero API cost),
render it with a Haiku-tier workflow subagent (production-parity model, D47), and score it
with two adversarial founder personas (technical-solo, commercial-cofounder) on the G3 rubric
(Recognition 0.30, Specificity 0.25, Credibility 0.20, Brevity 0.15, Tone 0.10). Pass needs
BOTH reviewers >= 8.0 weighted, every dimension >= 6, spread <= 1.5, zero blockers. Cap 5
iterations, else log BLOCKED. Scripts: loop/samples/render-review-v{2,3,4}.js.

Iteration history:

- **Iter 1 (FAIL 7.95 / 7.45):** majors were a broken SVG chart, repetition across sections,
  and ungrounded math. Fixed with a precomputed per-bar height fraction, deterministic brief
  anchoring, an anti-repetition rule, and a grounded footnote.
- **Iter 2 (REGRESSED 5.45 / 7.35):** the cheap model still drew the chart broken (value labels
  at negative y, off canvas), and the figures did not reconcile (net / multiple implied three
  costs; net headline contradicted the ramped Year-1 cumulative). Root-cause fix, not cosmetic:
  DROPPED the five-year projection entirely for founder-led (it belonged to the enterprise model
  and a founder guards the near term, the Twenty-Second Ledger insight), recast scenarios to
  gross "Value created" + a multiple, and added a "First-year cost" tile.
- **Iter 3 (FAIL 6.75 / 6.65, 1 blocker):** credibility 5 and 4 (below the 6 floor). Both
  reviewers did the arithmetic ON THE PAGE: value, multiple, and cost each rounded independently,
  so dividing displayed value by displayed multiple ($66K/2.8x etc.) returned three costs, none
  equal to the "$23K" tile, and the multiples looked rounded down. Second major: the single
  opaque "value created" total hid that 384 hrs * $150 = $57.6K was 58% of the $99K, so the
  cash-vs-time split was invisible. Specificity capped at 7 (every fact bio-inferable).
- **Iter 4 fixes (in src/verticals/founder-led-sales.ts + emit script):**
  1. RECONCILIATION: the displayed return multiple now derives from the SAME displayed thousands
     the page shows (`thousands()` helper): multiple = value-in-K / cost-in-K, and the cost tile
     renders `costK * 1000`. So value / multiple on the page returns the displayed cost exactly,
     and the headline (4.3x) equals the Expected card. Worked example now 2.9x / 4.3x / 5.5x.
  2. SPLIT: the footnote names both value terms with their own figures that sum to the headline
     ("$41K from deals won ... $58K from the 384 founder hours ... at $150 per hour"), so the
     reader sees how much is cash versus imputed time.
  3. SPECIFICITY (sample data only, not a code path): enriched the Cedar research with named,
     checkable facts (Cedar Cash, 4.5M seed led by Basis Set, YC W25, first 40 design partners,
     a 19-day bank-account wait), the kind only a researcher surfaces.
  4. REPETITION: sharpened the per-render anti-repetition instruction (each middle section a
     distinct job; each fact used at most once). The DESIGN_BRIEF stays byte-stable (D53).

The reconciliation principle: round ONCE to the precision the founder reads, then derive every
dependent figure from those displayed integers, so the on-page arithmetic is internally exact.
See [[founder-led-roi-model]], [[review-fixes]], [[tournament-results]], [[cost-discipline]].
