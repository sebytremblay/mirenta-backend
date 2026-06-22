---
name: g2-blocklist
description: The G2 enterprise-sales blocklist and matching rules for founder-facing generated copy
metadata:
  type: reference
---

G2 gate: generated founder-facing copy carries ZERO terms from this enterprise-sales blocklist
(and obvious morphological variants). The grep returns 0 matches across all generated samples.

**Seed blocklist (grow as reviewers flag new offenders):**
quota, rep, ramp, enablement, procurement, RFP, SQL/MQL, pipeline coverage, account executive,
SDR/BDR, territory, sales org, headcount plan, six-figure, enterprise-grade, stakeholder buy-in,
decision-maker matrix.

**Matching rules (avoid false positives):**
- Match on WORD BOUNDARIES, case-insensitive. "rep" must not match "represent", "prepare",
  "report", "reputation"; match "rep", "reps". "ramp" must not match "rampant"; match "ramp",
  "ramps", "ramping".
- The blocklist scopes to GENERATED FOUNDER-FACING COPY only (sample one-pager copy and the
  prompt-driven output), NOT to source-code comments, variable names, or the prompts' internal
  scaffolding. "adoption ramp" in a code comment is fine; "ramp your sales" in page copy fails.
- "SQL/MQL" and "SDR/BDR" mean the acronyms as marketing-funnel jargon. SQL the database language
  is not in scope for founder copy, but it will not appear there anyway; match the acronyms as
  standalone tokens.

**Canonical regex (word-boundary, case-insensitive), used by the G2 harness:**
\b(quota|reps?|ramp(s|ing|ed)?|enablement|procurement|RFP|MQL|SDR|BDR|territory|six-figure|
enterprise-grade|account executives?)\b  plus the multi-word phrases matched literally:
"pipeline coverage", "sales org", "headcount plan", "stakeholder buy-in", "decision-maker matrix".

The founder-led vertical's inputGuidance/domainGuidance/executiveTargeting must be blocklist-clean,
since they ride into the research kickoff and shape the generated copy. See [[codebase-map]].
