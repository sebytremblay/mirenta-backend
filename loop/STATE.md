# Loop State

Date opened: 2026-06-21

## Phase

DESIGN (T1), tournament (T2), MODEL+G1 harness (T3,T7), COPY (T4), research framing
(T5), customer zero (T6), G2 grep (T8), G3 gate (T9) all DONE. 194 tests pass, typecheck 0.
G3 passed on iteration 4 of 5 (8.25 / 8.15, zero blockers, spread 0.10) after a source fix
that makes every on-page figure reconcile to the precision the founder reads. Remaining:
finish DECISIONS.md note + commit the validated work (T10), then ship the HTML report (T11).

## Single next action

Finish T10: extend the D59 note with the reconcile-to-displayed-precision principle and
the deal/time split, then commit the validated work in focused commits (T8 harness + emit
script; the G3 value-model rewrite + tests; D59 + loop state). Then write the G5 HTML
report (T11): before/after copy, the four-iteration G3 score timeline, the commit log,
gate results (G1 57k-point sweep, G2 exit 0, G3 8.25/8.15), and residual risks (the
sales_marketing overstatement still live; the cheap builder put an em dash in the <title>;
the $41K deals figure is the softest input pending discovery).

## Health note

Baseline green: `npm test` 167 pass, 0 fail (exit 0); `npm run typecheck` exit 0.
The live `sales_marketing` value model overstates ROI (see memory); customer zero
still points at it. The reposition replaces it with a founder-led model.

## Hard rules in force

- No live Mirenta pipeline runs (Research Agent / Website Builder) for behavior
  checks. Workflow subagents write and score sample copy instead (cost discipline).
- Treat the files under `loop/` as ground truth across turns and compaction.
- Cite decision ids; log conflicts as open in DECISIONS.md, never overturn silently.
- House style in all prose: no contractions, active voice, present tense, strong
  verbs, no weak openers, no em dashes.
