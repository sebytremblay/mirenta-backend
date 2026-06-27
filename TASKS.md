# TASKS.md — build ledger for the dynamic per-lead pipeline

Check a box only when its acceptance criterion passes (typecheck + the named test). Each checked box ships in its own commit. Plan: `~/.claude/plans/bubbly-gathering-stream.md`. Decisions and invariants: `MEMORY.md`.

## Build steps

- [x] **1. Metric recipe schema + evaluator** (`src/domain/recipe.ts`). Acceptance: `recipe.test.ts` covers each op, each guard (clamp, `maxFactor`, `resultCeiling`, missing input, non-finite), the qualitative path, and the estimated→footnote disclosure. Typecheck clean. — 25 tests green.
- [x] **2. Move value contract** to `src/domain/value-contract.ts`; `assertValueModelContract` runs on evaluator output. Acceptance: existing contract test passes against the new path. — `value-contract.test.ts` green; `ValueResult` now lives here too.
- [ ] **3. Page spec schema + `validatePageSpec`** (`src/domain/page-spec.ts`). Acceptance: `page-spec.test.ts` covers unique ids, single banner, resolvable value/cta/quick-link ids, required-kind presence.
- [ ] **4. Generalize `validatePage`** to satisfy the spec, keeping every safety scan. Acceptance: `page-validation.test.ts` covers spec satisfied, missing declared section, figure outside value-render section, unverified quote rejected, asset host rejected.
- [ ] **5. De-verticalize `ResearchObject`** (`src/domain/research.ts`): drop `vertical.validateInputs`, carry `recipe_inputs`, validate against the persisted recipe. Acceptance: `research.test.ts` updated and green.
- [ ] **6. Strategist agent** (`src/agents/strategist.ts`, Opus): emits `{plan, recipe}`. Acceptance: prompt builder unit test; schema round-trips through `evaluateRecipe`.
- [ ] **7. Designer agent** (`src/agents/designer.ts`, Opus): emits `PageSpec`. Acceptance: prompt builder unit test; output round-trips through `validatePageSpec`.
- [ ] **8. Rework research + builder agents** to drive off the persisted plan/recipe/spec. Acceptance: builder unit tests updated; `buildSite` evaluates the recipe and renders the spec.
- [ ] **9. Four-stage worker** (`src/worker/tick.ts` + `entities.ts` JobStatus): `planning → researching → designing → building`. Drop `getVertical`. Acceptance: integration test covers the new transition guards.
- [ ] **10. Migration `0010_dynamic_pipeline.sql`**: add `jobs.strategy`, `jobs.page_spec`; drop `product_profiles.vertical`, `.economics`. Acceptance: applies cleanly to Supabase.
- [ ] **11. Delete `src/verticals/`** and its tests; replace with `recipe.test.ts` + `page-spec.test.ts`. Acceptance: `npm run test` green, no dangling imports.
- [ ] **12. Four-link subagent smoke chain** (`smoke-strategist`, `smoke-research`, `smoke-designer`, `smoke-builder`) chained through `/tmp`. Acceptance: two fixture leads produce two visibly different page structures from the same code.
- [ ] **13. Adversarial review loop** until critics find no founder click-blockers. Acceptance: log below converges.

## Review loop log

(Append one dated entry per iteration: click-blockers found, fixes applied, verdict.)
