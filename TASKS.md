# TASKS.md — build ledger for the dynamic per-lead pipeline

Check a box only when its acceptance criterion passes (typecheck + the named test). Each checked box ships in its own commit. Plan: `~/.claude/plans/bubbly-gathering-stream.md`. Decisions and invariants: `MEMORY.md`.

## Build steps

- [x] **1. Metric recipe schema + evaluator** (`src/domain/recipe.ts`). Acceptance: `recipe.test.ts` covers each op, each guard (clamp, `maxFactor`, `resultCeiling`, missing input, non-finite), the qualitative path, and the estimated→footnote disclosure. Typecheck clean. — 25 tests green.
- [x] **2. Move value contract** to `src/domain/value-contract.ts`; `assertValueModelContract` runs on evaluator output. Acceptance: existing contract test passes against the new path. — `value-contract.test.ts` green; `ValueResult` now lives here too.
- [x] **3. Page spec schema + `validatePageSpec`** (`src/domain/page-spec.ts`). Acceptance: `page-spec.test.ts` covers unique ids, single banner, resolvable value/cta/quick-link ids, required-kind presence. — 10 tests green.
- [x] **4. Generalize `validatePage`** to satisfy the spec, keeping every safety scan. Acceptance: `page-validation.test.ts` covers spec satisfied, missing declared section, figure outside value-render section, unverified quote rejected, asset host rejected. — 22 tests green; structural id checks run before the figure-in-section check.
- [x] **5. De-verticalize `ResearchObject`** (`src/domain/research.ts`): drop `vertical.validateInputs`, carry `recipe_inputs`, validate against the persisted recipe. Acceptance: `research.test.ts` updated and green. — `validateResearch(raw, recipe)` checks every named input arrives sourced.
- [x] **6. Strategist agent** (`src/agents/strategist.ts`, Opus): emits `{plan, recipe}`. Acceptance: prompt builder unit test; schema round-trips through `evaluateRecipe`. — pure parts in `strategist-prompt.ts`; 11 tests green.
- [x] **7. Designer agent** (`src/agents/designer.ts`, Opus): emits `PageSpec`. Acceptance: prompt builder unit test; output round-trips through `validatePageSpec`. — pure parts in `designer-prompt.ts`; 10 tests green.
- [x] **8. Rework research + builder agents** to drive off the persisted plan/recipe/spec. Acceptance: builder unit tests updated; `buildSite` evaluates the recipe and renders the spec. — `research.ts` reads `plan`+`recipe`; `builder.ts` evaluates the recipe and renders the page spec; `builder-prompt.test.ts` green.
- [x] **9. Four-stage worker** (`src/worker/tick.ts` + `entities.ts` JobStatus): `planning → researching → designing → building`. Drop `getVertical`. Acceptance: integration test covers the new transition guards. — four stages persist their artifacts; `readStrategy`/`readPageSpec` throw on a missing or invalid artifact. Integration test pending in step 13.
- [x] **10. Migration `0010_dynamic_pipeline.sql`**: add `jobs.strategy`, `jobs.page_spec`; drop `product_profiles.vertical`, `.economics`. Acceptance: applies cleanly to Supabase. — also teaches `claim_jobs` and `findActiveJobByEmail` the `planning`/`designing` statuses so those jobs lease and dedupe. APPLY to Supabase before any live worker run.
- [x] **11. Delete `src/verticals/`** and its tests; replace with `recipe.test.ts` + `page-spec.test.ts`. Acceptance: `npm run test` green, no dangling imports. — directory gone, `contract.ts` moved to `src/domain/value-contract.ts`, no references remain outside the smoke scripts (step 12).
- [x] **12. Four-link subagent smoke chain** (`smoke-strategist`, `smoke-research`, `smoke-designer`, `smoke-builder`) chained through `/tmp`, plus `smoke-render` validation and a shared `smoke-prompt.ts`. Acceptance: two fixture leads produce two visibly different page structures from the same code. — Origami: multiply/hours → "~28 hours each week", order hero>priorities>value>pov>narrative>cta>footer, art "Founder Focus". Menza: range_from_band/currency → "$15,000 to $35,000 per year", order hero>pov>value>priorities>narrative>cta>footer, art "Data Precision". Both pass production `validatePage`.
- [ ] **13. Adversarial review loop** until critics find no founder click-blockers. Acceptance: log below converges.

## Review loop log

### 2026-06-27 — iteration 1 (Origami + Menza, two skeptical-founder reviewers)

Both reviewers independently ranked the SAME #1 click-blocker, so it is a deterministic code defect, not run noise: the value **mechanism sentence renders garbled**. Two faults:
1. The template's `{input.<key>}` token fills with the input LABEL (a descriptor like "High-value prospects contacted per week"), but the strategist writes the sentence expecting a NUMBER there, so labels land in value slots and read as gibberish.
2. `{result}` already carries its unit ("~28 hours each week"), yet templates append a second unit word ("hours per week", "each quarter"), double-counting.

Secondary findings (content, not code): unverified-feeling quotes lacked visible sourcing; priorities read template-symmetric; the value figure felt unearned without a breakdown. The breakdown gap is the same root cause as fault 1 — a clean mechanism sentence with real sourced numbers answers it.

Verdict both pages: WOULD-NOT-CLICK, single biggest blocker the garbled mechanism.

Fix applied: add a `{value.<key>}` token the evaluator fills with the clamped sourced NUMBER, keep `{input.<key>}` for the label, and sharpen the strategist guidance so it writes number-grounded sentences and never appends a unit after `{result}`.

### 2026-06-27 — iteration 2 (Origami + Menza, two skeptical-founder reviewers)

The grammar fix held: both sentences now parse. Reviewers converged on two NEW figure defects, both checkable facts (gated deterministically per the two-reviewer-panel rule, not left to a prompt):
1. **Hidden factor breaks the visible arithmetic.** Origami showed "10 pitches x 2 hours" yet the headline read 11, because a sub-1 automation factor moved the figure without appearing in the sentence. The math looked broken and the number arbitrary.
2. **Doubled cadence in the headline.** Rendered "Hours back each week: ~11 hours each week"; the label restated the cadence the unit string already carries.

Verdict both pages: WOULD-NOT-CLICK.

Fixes applied (commit 04fb1d1): the strategist now rejects a mechanism that omits any declared input as `{value.<key>}` and a headline label that restates the unit cadence; the evaluator emits a `breakdown` of every sourced number and keeps fractional factors (0.7 no longer rounds to 1). Same commit answers the user's parallel design complaint.

### 2026-06-27 — design escalation (user feedback: "pages look super basic and underwhelming")

The user flagged the generated pages as flat and uncreative and pointed to `sample-sites/employee-service/tractor_supply.html` as the bar. Root cause: the builder brief asked for a thin document and the `value_render` guidance forbade the very elements (charts, stat tiles) that give a case page impact. Fix (commit 04fb1d1): the DESIGN BRIEF now demands a real design system (spacing scale, fluid type scale, layered shadows), a full-bleed hero, alternating grounds with a dark anchor, structured cards with hover lift, designed pull quotes, and a magnitude-encoded value visual fed by the new breakdown. Pages grew from ~16KB to 28KB (Origami) and 23KB (Menza), both passing production `validatePage`.

### 2026-06-27 — iteration 3 (design-literate founder reviewers, judging polish + click)

Both reviewers confirmed the figure now reconciles (22x2x0.65~=29; 35x2.2x0.82~=63) and the pages carry real design systems. Both still rated DESIGN: BELOW-BAR for three repeatable reasons, fixed deterministically in the brief: hero gradient too gentle, section washes too near-white to read as distinct bands, value chart not magnitude-encoded (uniform boxes / prose substituting for a chart). Brief now requires a saturated full-strength hero, visibly contrasting grounds, and a height-encoded SVG chart.

Remaining WOULD-NOT-CLICK blockers (arbitrary input volumes, unexplained automation rate, self-quote, generic priorities) are research/content quality. They are inherent to subagents MOCKING the research stage in the smoke chain; the production Haiku research agent sources grounded numbers and concrete priorities from Exa. The deterministic pipeline (figure honesty, design system, validation) is sound; content fidelity rides on the live research stage, not on code changes.
