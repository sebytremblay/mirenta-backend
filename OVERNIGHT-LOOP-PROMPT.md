# Overnight Reposition Loop

## Mission

Mirenta originally targeted enterprise sales. The new target is companies running
**founder-led sales to other founders**. Reposition the product holistically: the ROI
model, the generated website copy, and the framing. Mirenta is customer zero, so the
output must work exceptionally well on a founder who would buy it.

## North star (the only test that matters)

**A founder doing founder-led sales to other founders feels seen and heard.**

Every artifact you ship passes through this question. The adversarial founder reviewer
(below) is the instrument that measures it. Nothing merges until that instrument scores it.

## Success definition (global acceptance gate)

The loop is DONE when all of these hold, each verifiable without human judgment:

1. **G1 ROI sanity bound.** Every figure the ROI model emits clears the G1 bounds defined
   below. Run the model across at least 20 sampled founder-led inputs; zero outputs breach
   a bound.
2. **Build and tests green.** `npm test` passes with no skipped or excluded specs, and
   `npm run build` (or the repo equivalent) passes. Paste the exit codes into the ledger.
3. **G2 vocabulary clean.** Generated website copy and framing carry zero terms from the
   enterprise-sales blocklist defined below. The blocklist grep returns 0 matches across
   all generated samples.
4. **G3 founder rubric.** The adversarial founder reviewer scores the end-to-end output
   >= 8.0/10 weighted on the five-dimension rubric below, with every individual dimension
   >= 6/10 and zero open `blocker` items. Two independently spawned reviewers must both
   clear the gate (inter-reviewer spread <= 1.5 points), to keep one lenient judge from
   passing weak work.
5. **G4 decision integrity.** Every changed decision is reflected in `DECISIONS.md` with a
   cited id; new conflicts are logged as open decisions, not resolved unilaterally.
6. **G5 report shipped.** A final self-contained HTML report summarizes what changed, the
   before/after, the reviewer scores, the commit timeline, and residual risks.

If you cannot reach a criterion and the blocker needs a human, log it to the ledger as
`BLOCKED` with the exact question, then continue other workstreams. Never stall the loop.

## Gate definitions (the quantitative tests)

**G1 ROI sanity bounds.** A founder-led figure is valid only when ALL hold. Tune the
exact numbers against `DECISIONS.md` and the existing model on the first turn, then freeze
them in `loop/memory/`:

- Headline ROI multiple lands in `[1x, 20x]`. Anything above 20x reads as fantasy to a
  skeptical founder and fails. Anything below 1x means the product loses money and fails.
- Payback period resolves to a positive finite number of months `<= 24`.
- The model never multiplies a full rep roster by full baseline meetings (the known
  overstatement; see memory). Headcount input for a founder-led account is `<= 5`.
- Every input that feeds a headline number is named and sourced in the output; no figure
  appears without a traceable derivation.

**G2 enterprise-sales blocklist.** These terms (and obvious morphological variants) must
not appear in generated founder-facing copy. Maintain the list in `loop/memory/` and grow
it as the reviewer flags new offenders: `quota, rep, ramp, enablement, procurement, RFP,
SQL/MQL, pipeline coverage, account executive, SDR/BDR, territory, sales org, headcount
plan, six-figure, enterprise-grade, stakeholder buy-in, decision-maker matrix`.

**G3 founder "seen and heard" rubric.** The reviewer scores each dimension 0-10; the
weighted sum is the headline score. Each dimension carries an explicit pass floor so a
single strong dimension cannot mask a failing one:

| Dim | Weight | What a 10 looks like | What a 0 looks like |
|---|---|---|---|
| Recognition | 0.30 | Names the founder's actual lived problem in the first two lines | Generic "grow your sales" opener |
| Specificity | 0.25 | References the lead's real domain, stage, and named context | Mad-libs template with a slotted name |
| Credibility | 0.20 | Proof a founder trusts (named investor, peer, concrete outcome) | Vague claims, no named source |
| Brevity | 0.15 | A busy founder gets the point in under 20 seconds | Walls of text, buried lede |
| Tone | 0.10 | Founder-to-founder peer voice, zero salesiness | Vendor pitch, corporate register |

A `blocker` item is any single thing that would make the reviewer-as-founder close the tab:
a factual error, a fabricated quote, a wrong-domain reference, or a salesy opener. One
blocker fails the gate regardless of score.

## Operating model (the turn protocol)

You are the orchestrator. Keep your own context clean: do the thinking, delegate the
doing. Run this exact protocol every turn.

1. **Rehydrate.** Read `loop/STATE.md`, `loop/LEDGER.md`, and `loop/memory/INDEX.md`.
   These are the source of truth across turns and across context compaction. Trust them
   over your own recollection.
2. **Select.** Pick the highest-priority `TODO` task whose dependencies are `DONE`.
3. **Brief.** Spawn the subagent(s) for that task. Load each one with the facts it needs
   from prior turns (paste the relevant memory entries and file paths into its prompt) so
   it never re-explores known ground. State the task's acceptance criteria verbatim in the
   prompt and require the subagent to self-verify against them before returning.
4. **Validate.** Check the returned work against the task's Definition of Done. If it
   fails, return it with the specific gap. Run a closed loop until it passes.
5. **Commit.** Make one focused commit per validated task (see commit discipline).
6. **Record.** Update `loop/LEDGER.md` (task -> DONE, append any new TODOs), append durable
   facts to `loop/memory/` with an `INDEX.md` pointer, and update `loop/STATE.md` with the
   current phase and next action.
7. **Loop.** Return to step 1.

Prefer parallel subagents for independent tasks in one message. Define small, atomic tasks
with measurable acceptance criteria and let each agent close its own loop before returning.

**Explore freely.** You hold a standing license to invent approaches the human did not
specify, as long as each bet passes the same gates as the baseline. The workstreams below
are a floor, not a ceiling. When a subagent surfaces a sharper idea than the one it was
given, capture it as a new ledger task and run it through W5. Bias toward bold structural
bets over safe wording tweaks; the gates are strict enough to catch the bets that miss, so
the cost of a failed experiment is one logged memory entry, not a regression.

## On-disk state (survives compaction and restart)

Create and maintain under `mirenta-backend/loop/`:

- `STATE.md` — current phase, the single next action, and a one-line health note. The first
  thing any future turn reads to know where the loop stands.
- `LEDGER.md` — the task list. Each task: `id | title | status (TODO/DOING/DONE/BLOCKED) |
  deps | acceptance criteria | notes`. The audit trail of intent.
- `memory/INDEX.md` — one line per memory file: `- [slug](file.md) — hook`.
- `memory/*.md` — one durable fact per file (a decision made, a constraint discovered, a
  founder-voice principle, a rejected approach and why). Future agents read these instead
  of re-deriving them.

On any restart, reconstruct fully from these files. Write them as if the next agent has
none of your context, because it will not.

## The work (initial workstreams — refine in the ledger as you learn)

- **W1 ROI model.** Replace enterprise-sales economics with founder-led-sales economics.
  Founder-led means small teams, the founder's own time as the scarce input, and small
  deal counts, not a rep roster. The current model is known to overstate ROI by multiplying
  a full rep roster by full baseline meetings (see memory). Fix the unit economics so the
  output is defensible to a skeptical founder.
- **W2 Website copy.** Rewrite generated one-pager copy to address a founder selling to a
  founder. Drop procurement, rep enablement, and quota language. Speak to time scarcity,
  trust between founders, and concrete outcomes.
- **W3 Framing.** Update the product framing and any vertical/persona scaffolding that
  assumes enterprise buyers.
- **W4 Agent system prompts.** Update the Research Agent and Website Builder prompts so
  generation defaults to the founder-led frame.
- **W5 Divergent exploration (creative bets).** Do not just port the enterprise design to
  a founder audience. Generate and test bold structural changes to the one-pager that make
  a founder feel seen. This workstream runs in parallel and feeds winners back into W2-W4.

### W5 mechanics (explore -> test -> graft)

Run an idea tournament, not a single guess:

1. **Diverge.** Spawn 3 to 5 idea agents, each tasked to invent one structurally different
   approach to "make a founder feel seen and heard." Require genuinely different bets, not
   wording tweaks. Each agent returns the idea, the founder insight behind it, and a
   concrete before/after on one sample one-pager.
2. **Prototype.** Build a cheap sample of each idea (short-circuited generation, cheap
   model). No live paid pipeline for exploration.
3. **Judge.** Score every prototype with the same two-reviewer G3 rubric the production
   gate uses. An idea earns adoption only when it beats the current baseline on the
   weighted score.
4. **Graft.** Fold winners into W2/W4 and log losers in `loop/memory/` with the reason, so
   no future agent re-pitches a dead idea.

**Seed idea (already vetted by the human, build and test it first):** replace the quote
section that currently cites executives at the lead company with quotes from **profiled
investors in the lead's target domain** — for example a YC partner, an a16z partner, or a
Sequoia partner who invests in that space. The founder insight: a founder trusts what a
respected investor in their world says far more than a synthesized exec quote, and it
raises the Credibility dimension. Constraints that make this safe:

- Every quote must be real and attributable, sourced through the research path. A fabricated
  or misattributed investor quote is an automatic `blocker` and must never ship.
- The investor must plausibly map to the lead's actual domain and stage; a generic
  big-name quote with no domain fit fails Specificity.
- If a real, attributable, domain-matched quote cannot be found for a given lead, fall back
  gracefully rather than inventing one. Define and log the fallback.

Treat this seed as the template for how every creative bet is proposed, constrained, and
gated. Invent more in the same spirit.

## Validation loop (the self-evaluation engine)

For W2 and W4, run this loop until the founder reviewer passes:

1. **Smoke test the prompt.** Spawn a fresh Claude Code subagent whose system prompt is the
   candidate research/builder prompt. Drive it to produce sample output. Short-circuit any
   live model generation against a cheap model and do not run the paid pipeline for
   behavior checks (cost discipline below).
2. **Adversarial founder review.** Spawn two independent reviewer agents that role-play a
   founder whose time is precious and who clicks off at the first whiff of generic, salesy,
   or enterprise-flavored copy. Each scores all five G3 dimensions, returns the weighted
   headline score, and lists feedback items tagged `blocker | major | minor`. Give the two
   reviewers different founder personas (for example a technical solo founder and a
   commercial co-founder) so they probe different failure modes.
3. **Gate.** Pass requires the G3 gate: both reviewers >= 8.0 weighted, every dimension
   >= 6, inter-reviewer spread <= 1.5, and zero `blocker` items across both. On failure,
   feed the union of feedback into the next revision. Cap at 5 iterations per artifact; if
   still failing, log `BLOCKED` with both reviewer transcripts and move on.

## Cost discipline (hard constraint)

Each Research Agent and Website Builder run spends real money. To exercise behavior, point
at a cheap model and short-circuit the call so no live generation runs. Run the full
pipeline only when an acceptance criterion genuinely requires live output, and log the
reason in the ledger.

## Decision-record discipline (hard constraint)

`DECISIONS.md` is settled. When work touches a decision, cite its id (e.g. D13, D50). When
the reposition conflicts with a settled decision, log it as a new open decision; do not
overturn it unilaterally. Use the terms fixed in `TERMINOLOGY.md`.

## Commit discipline (the morning audit log)

Commit incrementally, one focused commit per validated task. Each commit message states what
changed and why in house style, so a high-level skim in the morning reconstructs the night
and any commit rolls back cleanly. Do not batch unrelated changes.

## Reporting (for the human)

Produce takeaways as a single self-contained HTML page under `loop/` with diagrams and
before/after visuals: the ROI model change, copy samples, the reviewer's final scores, the
commit timeline, and any `BLOCKED` items awaiting a decision. Optimize for a 60-second skim.

## Writing style

No contractions, active voice, present tense, strong verbs, no weak openers, no em dashes,
in all code, comments, and prose.

## Stop and resume conditions

- **Stop** when the global acceptance gate holds, or when every remaining task is `BLOCKED`
  on a human. Write the final HTML report and a closing `STATE.md` note either way.
- **Resume** any time by reading `STATE.md`, `LEDGER.md`, and `memory/INDEX.md`, then
  re-entering the turn protocol at step 2. Treat the disk as ground truth.
