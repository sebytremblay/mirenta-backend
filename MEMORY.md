# MEMORY.md — durable decisions and invariants for the dynamic pipeline

This file records intent that a new session cannot re-derive from the code alone. Read it before changing the pipeline. It is the project-scoped companion to `TASKS.md` (the build ledger). Both are checked into the repo.

## Why this redesign exists

The old pipeline routed every lead through `src/verticals/` — three hardcoded buckets, each hand-coding research targeting and a deterministic value model, feeding one fixed 7-section page layout chosen from a closed menu of five art directions. Every page wore the same bones in one of five skins, so the output read as AI-generated, and adding a vertical meant writing code. The redesign makes the page structure, the value metric, and the styling adapt per lead, while holding cost down by splitting judgment (two small Opus planning calls) from labor (two Haiku generation calls).

## Locked decisions (do not relitigate without the user)

1. **No vertical registry.** `src/verticals/` is deleted. One dynamic path per lead, no fallback bucket. The strategist plans each lead from scratch.
2. **The value figure is computed by deterministic code, never emitted by an LLM.** Opus plans a *metric recipe*; Haiku research sources the named inputs as facts; `evaluateRecipe` (in `src/domain/recipe.ts`) runs the closed-set formula. This preserves the no-fabrication invariant and prevents the prior overstated-ROI bug (a value model multiplied full rep roster × full baseline meetings).
3. **The page design is a bespoke per-lead spec.** Opus (designer) emits a `PageSpec`; validation satisfies that spec, not a fixed section list.

## Invariants that must never regress

- **No-fabrication.** `evaluateRecipe` produces the displayed number; the LLM never writes it. `assertValueModelContract` (moved to `src/domain/value-contract.ts`) still runs on the evaluator output and still requires a footnote whenever any input is estimated.
- **No optional fallback chains.** Needed fields are required with one path; no optional-field + `??`-default branches. Required by the user's standing rule. Fields this forces: `RecipeInput.min`, `RecipeInput.max`, `MetricRecipe.maxFactor`, `MetricRecipe.resultCeiling`, the `ratio` denominator, `PageSpec.valueRenderSectionId`, `PageSpec.ctaSectionId`, every sourced input the recipe names, the `strategy` artifact before research runs, and the `page_spec` artifact before build runs. A missing one throws.
- **Recipe operation set is closed.** `identity` (incl. the qualitative literal, one path), `sum`, `multiply` (each input clamped, product bounded by `maxFactor`), `ratio` (required denominator), `range_from_band` (the generalization of the old `band_hours`). Each op exists to prevent a specific failure; do not add `eval`-style flexibility.
- **Page-spec safety checks survive verbatim.** Self-contained doc, no `script`/`iframe`/`object`/`embed`/`form`, no inline handlers or `javascript:`, asset host allow-list, unverified quotes never rendered, body word budget, accessibility landmarks tied to headings, the value figure present verbatim. Only the hardcoded `#business-case`/`#book` section list becomes spec-driven.

## Cost discipline

Run the full live pipeline sparingly. The build exercises behavior with subagents mocking the four LLM stages (no live API spend), chaining through `/tmp` files. Opus only ever emits compact plans; Haiku does the token-heavy generation.

## Operational notes

- Apply migration `0010_dynamic_pipeline.sql` to Supabase before any live worker run (unapplied migrations stall the pipeline and re-spend research).
- `research.payload` is untyped JSONB, so the new `{research, recipe_inputs}` shape needs no migration. New artifacts `jobs.strategy` and `jobs.page_spec` do.
