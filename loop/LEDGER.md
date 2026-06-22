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
| T2 | W5 idea tournament: diverge + judge structural bets | DOING | T0 | 3-5 distinct bets prototyped on sample copy; two-reviewer G3 scoring; winners + losers logged in memory | seed: investor-quote section; Judge phase running |
| T3 | Implement founder-led value model (code) | TODO | T1 | new/repointed vertical computes within G1 bounds across >= 20 inputs; unit tests green; disclosure contract holds | |
| T4 | Rewrite Website Builder copy/brief for founder-to-founder | TODO | T2,T3 | DESIGN_BRIEF + prompt assembly speak founder-to-founder; blocklist-clean; sample passes G3 | |
| T5 | Rewrite Research Agent prompt for founder-led frame | TODO | T2,T3 | system prompt + kickoff default to founder-led; investor-quote phase wired with fallback | |
| T6 | Update framing / persona scaffolding + customer zero | TODO | T3 | customer-zero (run-pipeline-mirenta) targets a founder, not an AE; framing carries no enterprise persona | |
| T7 | G1 harness: >= 20 sampled inputs, zero breaches | TODO | T3 | a runnable check sweeps >= 20 founder-led inputs and asserts every G1 bound | log exit code |
| T8 | G2 blocklist grep harness over generated samples | TODO | T4,T5 | grep returns 0 matches across all generated founder-facing samples | |
| T9 | G3 production gate: two-reviewer review of end-to-end output | TODO | T4,T5,T6 | both reviewers >= 8.0, every dim >= 6, spread <= 1.5, zero blockers | <= 5 iterations |
| T10 | G4 DECISIONS.md update + conflict log | TODO | T3,T4,T5,T6 | every changed decision cited; conflicts logged open | |
| T11 | G5 final HTML report | TODO | T1-T10 | self-contained HTML under loop/ with before/after, scores, commit timeline, risks | |
