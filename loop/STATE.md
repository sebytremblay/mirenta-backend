# Loop State

Date opened: 2026-06-21
Loop closed: 2026-06-22

## Phase

COMPLETE. All eleven tasks resolved. Five gates pass (G1, BUILD, G2, G4, G5); G3 is
BLOCKED at the five-iteration cap with the exact human question logged in the ledger.
194 tests pass (0 skipped), typecheck exit 0, G1 81,536-point sweep zero breaches, G2
grep exit 0. The committed sample page (loop/samples/founder-onepager.html) is the
iteration-5 render: blocker-free, every researched number accurate, every computed
figure reconciling. The final report ships at loop/REPORT.html.

## Single next action

None for the loop itself; it is closed. The one open item needs a human: decide how to
close G3 (see the BLOCKED section in loop/LEDGER.md). Either add a per-render
required-facts instruction that names the must-cite specifics (Cedar Cash, Basis Set,
the seed size, the W25 batch) and guards the domain-inversion line, then re-open the
gate, or raise the builder model above the Haiku tier D47 pins for cost. Both are a
quality-versus-cost call.

## What G3 revealed (the load-bearing finding)

A two-reviewer panel can miss a fabrication blocker. Iteration 4 scored 8.25 / 8.15 with
zero blockers from the two original reviewers, yet a fresh three-reviewer adversarial
re-score caught a factual error both originals missed: the Haiku builder rendered "Fifty
design partners" when the research states 40. The page validator (D54) did not catch it
because it enforces computed figures, not researched prose numbers. The fix pins
researched numbers verbatim in the neutral brief (D53) AND gates them deterministically
before any human scores the render. Iteration 5 is blocker-free and accurate but scores
7.85 / 7.50 because the cheap builder, once held to the exact count, drops the ownable
specifics that lifted iteration 4. Accurate-but-lower beats high-but-false, so iteration
5 is the committed artifact.

## Hard rules in force (held throughout)

- No live Mirenta pipeline runs (Research Agent / Website Builder) for behavior
  checks. Workflow subagents rendered and scored sample copy instead (cost discipline).
- Treat the files under `loop/` as ground truth across turns and compaction.
- Cite decision ids; log conflicts as open in DECISIONS.md, never overturn silently.
- House style in all prose: no contractions, active voice, present tense, strong
  verbs, no weak openers, no em dashes.

## Residual risks (carried in the report and D59)

- G3 quality ceiling on the Haiku builder: accurate copy scores in the high sevens.
- The `sales_marketing` ROI overstatement stays live on this branch (additive reposition).
- The $41K deals-won term is the softest input, pending real discovery.
