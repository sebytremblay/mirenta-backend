# Mirenta Backend MVP: Decision Record

This file records the system-design decisions resolved for the backend MVP. An automated fan-out over the design corpus surfaced 31 open questions on 2026-06-17. The founder resolved them on 2026-06-18. A second fan-out then surfaced 12 decisions the first round left open, recorded in [OPEN_DECISIONS.md](OPEN_DECISIONS.md); the founder resolved those on 2026-06-18 as well, and the [Second Resolution Round](#second-resolution-round) section below captures them as D32 through D43. A third fan-out surfaced three more open decisions; the founder resolved the first of them on 2026-06-18, captured as D44 in the [Third Resolution Round](#third-resolution-round). This record captures each resolution and its rationale.

The detailed designs that implement these decisions live in [mvp-pipeline-architecture](mirenta-docs/technical/mvp-pipeline-architecture.md), [mvp-data-model](mirenta-docs/technical/mvp-data-model.md), and [research-agent-design](mirenta-docs/technical/research-agent-design.md). Deferred work lives in [BACKLOG](mirenta-docs/technical/BACKLOG.md).

## Framing

The decisions narrowed the scope before resolving the details. Three framing answers shaped everything below:

- **Backend only.** This program builds the backend API. A co-founder owns the frontend, onboarding UI, campaigns, email, and go-to-market. Decisions that belong to those tracks fell out of scope.
- **Fresh standalone backend.** The earlier `mirenta-website` repository held an unrelated competitor-ads prototype a co-founder added as reference. The founder discarded it and deleted the repository. No code carries forward.
- **External multi-tenant SaaS, Salesforce-first.** Mirenta sells to SDRs and founders who self-serve and pay. The MVP proves the Salesforce HR and ITSM vertical, on a research schema that stays vertical-agnostic underneath.

## Resolutions

| ID | Decision | Resolution |
|----|----------|------------|
| D1 | Source of truth across the three visions | Backend builds to the technical pipeline docs. The README and GTD describe the whole product, which a co-founder owns. |
| D2 | Single-vertical vs horizontal | Salesforce-first, with a deliberately vertical-agnostic research schema that has room to extend. |
| D3 | Internal tool vs external SaaS | External multi-tenant SaaS: SDRs and founders self-serve, sign up, and pay. |
| D4 | Fate of the Prompt Place codebase | Discarded. The `mirenta-website` repo is deleted. Start the backend from scratch. |
| D5 | AI provider | Anthropic Claude plus Exa, per the docs. |
| D6 | Search and fetch provider | Exa, behind an abstraction. The built-in `web_search` and `web_fetch` run verbose and less accurate. |
| D7 | Realtime vs Batch | Realtime for the MVP. Batch lands as a cost fast-follow at volume. |
| D8 | Research caching | No cross-lead cache for the MVP. Keep the byte-stable prompt-prefix cache. Company-grained caching is a fast-follow. |
| D9 | Page build model | Agent-emitted self-contained HTML. The template engine defers to the generic-platform phase. |
| D10 | Deliverable and content scope | One-pager only with a simple ROI summary. The white paper folds into research content. |
| D11 | Brand asset sourcing | The agent scrapes and inlines logo, favicon, and theme at build time, preserving the single-object constraint. |
| D12 | Preview gate vs auto-publish | One-shot, no edits, auto-publish. |
| D13 | Agent runtime and worker compute | Managed Agents run the loop in ephemeral sandboxes. The worker runs as a short scheduled tick; its host is an open prototype question. |
| D14 | Handrolled durability vs engine | Handrolled now, with a migration trigger tied to the domain fast-follow. |
| D15 | Orchestration unit | Batch submission, one job per lead. The API returns a `leadId` to `jobId` map, and the client polls each job. |
| D16 | Serving target | Raw S3 endpoint behind a thin storage abstraction, so a branded subdomain and CDN can front it later. |
| D17 | Tenancy model | Organization tenancy from day one, since the SaaS model needs teams and reversing it later costs more. |
| D18 | Gateway authentication | Two-tier. Supabase session mints user and org identity server-side; an internal credential authenticates the worker. |
| D19 | Location of pipeline tables | A fresh backend service on Supabase Postgres. |
| D20 | Research object schema | Generic core plus a pluggable domain extension. Keep it simple now, with room to extend. |
| D21 | Product-profile schema and gate | Explicit required columns, gated on non-null, rather than a single onboarding boolean. |
| D22 | Lead ingestion | A dedicated `leads` table. Low lift, scales better, and carries an `email` column for the later email track. |
| D23 | Retention | Couple research retention to the published-site window; the cleanup sweep deletes both together. |
| D24 | Email, campaign, analytics | Out of the backend MVP. The pipeline stops at the published URL. |
| D25 | Sending model and vendor | Not applicable. Email is out of backend scope. |
| D26 | Open and click tracking | Not applicable for the MVP. |
| D27 | Reply-rate and inbound | Not applicable for the MVP. |
| D28 | Analytics substrate | Not applicable for the MVP. |
| D29 | Page access control | Fully public, no signature, per the locked S3-direct decision. |
| D30 | Worker tenancy isolation | Application-level `org_id` filtering for the MVP. RLS is a documented fast-follow in [BACKLOG](mirenta-docs/technical/BACKLOG.md). |
| D31 | Prompt-injection posture | Accept the risk for the MVP. Guardrails are a documented fast-follow in [BACKLOG](mirenta-docs/technical/BACKLOG.md). |

## Notable rationale

A few resolutions carry consequences worth stating plainly.

**D13 left one question open.** Managed Agents host the agent loops in ephemeral sandboxes, one per request, so no long-running loop sits in Mirenta's compute. The worker only starts sessions, polls them, and persists results, which keeps each tick short. The scheduler and compute host for that tick stay unlocked; the [mvp-pipeline-architecture](mirenta-docs/technical/mvp-pipeline-architecture.md) doc records candidate hosts and flags the choice for the prototype. The stakes stay low because no tick holds a heavy loop.

**D15 reshaped the API contract.** The original doc returned a single `jobId` per submission. The batch-submit model returns a map of `leadId` to `jobId`, and the client polls each job independently. A nullable `batch_id` groups jobs for rollup status without pulling campaign lifecycle into the backend.

**D17 and D18 replaced the flat-userID model.** The original doc keyed tenancy on a flat `userID` with a single first-party auth key. The SaaS decision (D3) made organization tenancy the right foundation, and Supabase Auth supplies the session that mints identity server-side. The client never asserts the tenant.

**D30 and D31 carry accepted risk.** The MVP ships without RLS and without prompt-injection guardrails. Both are real exposures, both are logged in [BACKLOG](mirenta-docs/technical/BACKLOG.md) with their triggers, and both should land before meaningful external traffic.

## Second Resolution Round

A second automated fan-out over the corpus surfaced 12 decisions the first round left open, captured in [OPEN_DECISIONS.md](OPEN_DECISIONS.md) with the tradeoffs. The founder resolved them on 2026-06-18.

| ID | Decision | Resolution |
|----|----------|------------|
| D32 | Worker scheduler and compute host | Supabase scheduled function paired with an edge function. The founder leans this way and flags low confidence, so the prototype confirms the pg_cron granularity and edge-runtime duration fit a worst-case tick before the choice locks. |
| D33 | Spend ceiling and rate-limit backpressure | None for the MVP. The `attempts` ceiling and the lease bound the loop. A spend ceiling and a rate-limit circuit breaker move to [BACKLOG](mirenta-docs/technical/BACKLOG.md). |
| D34 | Lead-submit deduplication | Natural-key dedupe on `org_id` plus lead email. A seller-triggered regenerate flag forces a fresh job for a lead from the UI, since the MVP supports no editing and regenerates the whole page. |
| D35 | Research-agent model tier | Sonnet across every research phase, no Opus escalation and no confidence-gate retry. Opus is available to the Website Builder, where synthesis quality on the customer-facing artifact justifies the cost. |
| D36 | Research-quality gate before Build | No quality bar. A schema-valid research object proceeds to Build regardless of completeness. A minimum-quality gate moves to [BACKLOG](mirenta-docs/technical/BACKLOG.md). |
| D37 | Quote-verification rigor | Keep the strict per-quote re-fetch verification. Every quote re-confirms against its source and any quote that fails drops, even though the white paper folded into research content (D10). |
| D38 | ROI-input estimation and disclosure | Follow the model flow in [personalized-site-creation-workflow.md](mirenta-docs/research/personalized-site-creation-workflow.md) (Step 4) and [salesforce-ai-outbound-email-skill.md](mirenta-docs/research/salesforce-ai-outbound-email-skill.md): apply the fixed per-employee ticket and interaction formulas to total headcount, flag estimated staff counts, and present the dollar figure with the reference scenarios. |
| D39 | Org onboarding | Auto-create one personal org per signup with the user as owner. Org merging is a future concern, not an MVP feature. |
| D40 | Lead uniqueness constraint | No backend uniqueness constraint. The frontend owns dedupe on upload. The backend inserts what it receives. |
| D41 | Lawful basis and erasure path for prospect data | Do nothing for the MVP. The exposure moves to [BACKLOG](mirenta-docs/technical/BACKLOG.md) alongside the other accepted-risk items. |
| D42 | Brand-asset reproduction | Inline the prospect's real logo and favicon, scraped at build time, to maximize the made-for-you effect. The team accepts the trademark, false-affiliation, and takedown exposure for the MVP. |
| D43 | Public-page disclaimer | No disclaimer. The page ships without an AI-generated or unaffiliated notice, which preserves the authentic effect and carries the accepted content and affiliation exposure. |

### Notable rationale, second round

**D34 and D40 split deduplication across two layers.** The frontend dedupes leads on upload (D40), so the backend adds no uniqueness constraint to the `leads` table. The Lead Service still dedupes at submission on `org_id` plus email (D34) to stop a double-submit from spending twice, and a regenerate flag bypasses that dedupe to force a fresh job when a seller chooses to rebuild a page.

**D35 simplified the research agent.** The original model strategy tiered the model per phase and reserved Opus for a confidence-gated escalation. The founder collapsed this to Sonnet across all four research phases with no escalation, which removes the confidence-gate threshold, the per-phase scoring step, and the retry budget the prior design left unspecified. Opus moves to the Website Builder, where it improves the one artifact the prospect sees.

**D33, D36, and D41 are accepted-risk deferrals.** The MVP ships without a spend ceiling, without a research-quality gate, and without a privacy lawful-basis or erasure path. Each is logged in [BACKLOG](mirenta-docs/technical/BACKLOG.md) with its trigger, joining the RLS (D30) and prompt-injection (D31) deferrals.

**D42 and D43 stack content exposure.** The page inlines a prospect's trademark and carries no disclaimer, both under the seller's outbound brand. Combined with the accepted prompt-injection risk (D31) and the deferred privacy path (D41), the public page carries real legal exposure that the team accepts to prove demand. These should reconcile before meaningful external traffic.

## Third Resolution Round

A third automated fan-out over the corpus surfaced three decisions the prior rounds left open, captured in [OPEN_DECISIONS.md](OPEN_DECISIONS.md) with the tradeoffs. The founder resolved the first on 2026-06-18; the other two remain open and wait until before external traffic.

| ID | Decision | Resolution |
|----|----------|------------|
| D44 | Public API surface for a seller-triggered regenerate | A `regenerate: true` flag on `POST /leads` that references the existing `lead_id`. The submit route carries both create and rebuild, and the flag bypasses the `(org_id, email)` submission-time dedupe (D34) to force a fresh job. The response reuses the D15 `leadId` to `jobId` map, so a regenerate adds one map entry keyed on the referenced `lead_id`. |

### Notable rationale, third round

**D44 reuses the submit contract rather than adding a verb.** The dedicated `POST /leads/{leadId}/regenerate` route read cleaner, but the flag-on-submit option keeps the public contract to one write endpoint and one response shape (the D15 map), which the co-founder's frontend already codes against. The client references the existing `lead_id` rather than re-sending the full payload, so the rebuild path does not collide with the no-uniqueness-constraint decision (D40) by inserting a duplicate lead row. The cost is that `POST /leads` now carries two semantics, create and rebuild, which the request body disambiguates through the presence of the flag and the referenced `lead_id`.
