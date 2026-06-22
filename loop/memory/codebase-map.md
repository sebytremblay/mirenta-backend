---
name: codebase-map
description: Where each workstream's code lives
metadata:
  type: project
---

Workstream-to-file map for the reposition (all paths under `mirenta-backend/`):

**W1 ROI model:**
- `src/verticals/sales-marketing.ts` — the live rep-roster model to replace (overstates ROI).
- `src/verticals/types.ts` — `VerticalEconomics`, `ValueModel`, `ValueResult`, `BoundValueModel`.
- `src/verticals/contract.ts` — `validateEconomicsShape`, `validateDisclosurePolicy`,
  `DISCLOSURE_SCENARIO_NAMES` = ["Conservative","Expected","Aggressive"] (D49, hardcoded;
  D58 flags vertical-aware naming as open). `assertValueModelContract` is the test helper.
- `src/domain/format.ts` — `formatDollars`.
- `src/verticals/index.ts` — registry + `DEFAULT_VERTICAL_ID` (= generic).
- `src/verticals/generic.ts`, `employee-service.ts` — the other two verticals (do not break).

**W2 Website copy:**
- `src/agents/builder-prompt.ts` — `DESIGN_BRIEF` (cache-stable system prompt),
  `buildUserPrompt`, `renderValueBlock`. Copy and section structure live here.
- `src/agents/builder.ts` — build loop, validation, retries. `REQUIRED_ANCHORS`.
- `src/domain/page-validation.ts` — `validatePage` (figures verbatim, anchors, quotes,
  hosts), `injectRuntimeAssets`.

**W4 Research Agent:**
- `src/agents/research.ts` — `buildAgentSystemPrompt` (frozen, vertical-neutral, cached),
  `buildKickoff` (per-lead, carries the vertical brief). Five-phase methodology.
- `src/domain/research.ts` — `ResearchObject`, `Quote {text,speaker,source_url,verified}`,
  `validateResearch`, `RESEARCH_TOOL_SCHEMA` (frozen on the Managed Agent).
  IMPORTANT: investor-quote seed (W5) needs NO schema migration; quotes already fit.

**W3/W6 Framing + customer zero:**
- `scripts/run-pipeline-mirenta.ts` — customer zero. Currently declares `sales_marketing`
  and targets a Salesforce Account Executive. Reposition to a founder.
- `src/services/personalization.ts` — `saveProfile`, vertical resolution.

**Tests:** `tests/unit/*.test.ts`, `tests/fixtures/profile.ts`. Disclosure contract test
helper: `assertValueModelContract(result, estimated)`.

See [[roi-overstatement-live]] and [[cost-discipline]].
