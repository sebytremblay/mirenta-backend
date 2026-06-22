# Loop Ledger

Audit trail of intent. Each task: `id | title | status | deps | acceptance | notes`.
Status: TODO | DOING | DONE | BLOCKED.

## Gates (global acceptance)

- G1 ROI bounds: headline multiple in [1x, 20x], payback positive finite <= 24 mo,
  founder-led headcount input <= 5, every headline figure named and sourced. >= 20
  sampled founder-led inputs, zero breaches.
- BUILD: `npm test` (no skips/excludes) and `npm run typecheck` both exit 0; exit
  codes logged.
- G2 vocabulary: enterprise blocklist greps to 0 matches across generated samples.
- G3 founder rubric: two independent reviewers both >= 8.0 weighted, every dimension
  >= 6, spread <= 1.5, zero blockers.
- G4 decisions: every changed decision cited in DECISIONS.md; conflicts logged open.
- G5 report: self-contained HTML shipped under loop/.

## Tasks

| id | title | status | deps | acceptance | notes |
|----|-------|--------|------|------------|-------|
| T0 | Bootstrap loop state + map codebase | DONE | - | loop/ files exist; baseline test+typecheck exit 0 captured | tests 167 pass; typecheck 0 |
| T1 | Design founder-led ROI model + freeze G1 numbers | DONE | T0 | G1 bounds frozen in loop/memory; unit-economics design defensible to a skeptical founder; headcount input <= 5 | founder_led_sales model; 30 samples all in bounds (worst 5.21x, payback 8.2mo); frozen in memory |
| T2 | W5 idea tournament: diverge + judge structural bets | DONE | T0 | 3-5 distinct bets prototyped on sample copy; two-reviewer G3 scoring; winners + losers logged in memory | 5 bets judged; baseline 1.3; ADOPT Shared Scar (7.95) + Mirror-First (7.43) hero, partial Ledger (5.03); REJECT both investor-quote bets (fabrication blockers). See tournament-results memory |
| T3 | Implement founder-led value model (code) | DONE | T1 | new/repointed vertical computes within G1 bounds across >= 20 inputs; unit tests green; disclosure contract holds | src/verticals/founder-led-sales.ts; registered; 188 tests pass (+21); typecheck 0. Recalibrated constants after a full-grid sweep caught a floor breach in the frozen design |
| T4 | Rewrite Website Builder copy/brief for founder-to-founder | DONE | T2,T3 | DESIGN_BRIEF + prompt assembly speak founder-to-founder; blocklist-clean; sample passes G3 | added narrativeGuidance seam field; founder-led spec grafts Shared Scar + Mirror-First winners; brief stays neutral/cache-stable; G3 in T9 |
| T5 | Rewrite Research Agent prompt for founder-led frame | DONE | T2,T3 | system prompt + kickoff default to founder-led; investor-quote phase wired with fallback | system prompt stays frozen/neutral by design; founder framing rides the kickoff via spec domain/exec/input guidance; rejected investor-quote bet means NO fabrication path, D37 verified-quote rigor stands |
| T6 | Update framing / persona scaffolding + customer zero | DONE | T3 | customer-zero (run-pipeline-mirenta) targets a founder, not an AE; framing carries no enterprise persona | run-pipeline-mirenta sells to Devin Park (founder, Cedar), declares founder_led_sales, verifies multiple+dollar return |
| T7 | G1 harness: >= 20 sampled inputs, zero breaches | DONE | T3 | a runnable check sweeps >= 20 founder-led inputs and asserts every G1 bound | tests/unit/founder-led-g1-harness.test.ts; 57,000-point sweep, zero breaches; runs under npm test (exit 0) |
| T8 | G2 blocklist grep harness over generated samples | DONE | T4,T5 | grep returns 0 matches across all generated founder-facing samples | scripts/g2-blocklist-grep.sh; 0 matches over the assembled prompt USER section AND the passing one-pager (tags stripped); exit 0 logged |
| T9 | G3 production gate: founder-review of end-to-end output | BLOCKED | T4,T5,T6 | both reviewers >= 8.0, every dim >= 6, spread <= 1.5, zero blockers; cap 5 iters | BLOCKED at the 5-iteration cap. No render clears the FULL gate (both originals >= 8.0 AND zero blockers). Iter 4 scored 8.25/8.15 but an adversarial re-score panel (verify-loop.js) caught a factual blocker the two originals missed: Haiku rendered "Fifty design partners" when research says 40. Iter 5 fixed it at source (neutral FIGURES rule pins researched numbers verbatim + a deterministic render gate) and scores ZERO blockers, arithmetic clean, but 7.85/7.50 on the originals (panel 8.05/6.85/7.35/7.85/7.50): the honest render dropped the ownable specifics (Cedar Cash, Basis Set, $4.5M seed, W25) that lifted iter-4 specificity. Committed artifact is iter 5 (blocker-free and accurate). See HUMAN QUESTION below and g3-iterations memory |
| T10 | G4 DECISIONS.md update + conflict log | DONE | T3,T4,T5,T6 | every changed decision cited; conflicts logged open | D59 records the reposition, the multiple headline, the 3 G1 invariants, the W5 grafts, no fabrication, framing-as-data, the reconcile-to-displayed-precision principle, and both Open conflicts; the founder-led code cites D59. Committed d29ad1b |
| T11 | G5 final HTML report | DOING | T1-T10 | self-contained HTML under loop/ with before/after, scores, commit timeline, risks | the report tells the truth: G1/BUILD/G2/G4 pass, G3 BLOCKED at cap |

## BLOCKED items (need a human)

- **T9 / G3 founder rubric.** Question for a human: the founder-led one-pager cannot simultaneously
  (a) state the lead's own design-partner count correctly AND (b) score both original reviewers >= 8.0,
  within the 5-iteration cap, using the Haiku builder pinned by D47. The blocker-free iter-5 render scores
  7.85 / 7.50 because the cheap model, once forced to copy the count verbatim, drops the ownable specifics
  (Cedar Cash, Basis Set Ventures, the $4.5M seed, the W25 batch) that a researcher would name. Two paths,
  both a human quality-versus-cost call: (1) add a per-render REQUIRED-FACTS instruction that names those
  specifics as must-cite and guards the "you need a banking partner" domain-inversion line, then re-open the
  gate; or (2) raise the builder model above Haiku for this segment, which reopens D47 (cost). Pick one.
