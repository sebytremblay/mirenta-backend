# Loop State

Date opened: 2026-06-21

## Phase

DESIGN done (T1 frozen). W5 tournament Judge phase running in Workflow 1.

## Single next action

Read Workflow 1's tournament results (ranked ideas vs baseline), record winners and
losers in loop/memory, then run Workflow 2 to IMPLEMENT the founder_led_sales value
model (T3) per the frozen design in loop/memory/founder-led-roi-model.md, with the
G1 harness and unit tests.

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
