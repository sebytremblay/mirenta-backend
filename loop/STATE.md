# Loop State

Date opened: 2026-06-21

## Phase

DESIGN (T1), tournament (T2), MODEL+G1 harness (T3,T7), COPY (T4), research framing
(T5), customer zero (T6) all DONE. Adversarial review applied (clamp hardened, harness
extended to non-finite corners, labels honest). 191 tests pass, typecheck 0. Remaining:
G2 grep harness (T8), G3 production gate (T9), DECISIONS.md + D59 (T10), HTML report (T11).

## Single next action

Build the G2 blocklist grep harness (T8): a runnable check that greps the enterprise
blocklist (see g2-blocklist memory) over generated founder-facing samples and returns
zero matches. To stay within cost discipline, generate sample one-pager copy with a
workflow subagent (no live pipeline), then grep it plus the founder-led spec's
rider fields. Then run the G3 two-reviewer production gate (T9) on an end-to-end sample.

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
