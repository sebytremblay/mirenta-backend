---
name: cost-discipline
description: No live Mirenta pipeline for behavior checks; use workflow subagents on sample copy
metadata:
  type: project
---

Each live Research Agent and Website Builder run spends real money (Claude Managed Agents
+ Messages API + Exa + S3). The overnight loop checks BEHAVIOR, not live output, so it must
not run the paid pipeline.

**How the loop exercises behavior cheaply:**
- ROI model (W1): pure deterministic TypeScript. Exercise it by importing `createValueModel`
  and calling `compute` over sampled inputs. No model call at all.
- Copy and prompts (W2/W4/W5): workflow subagents role-play the candidate Research/Builder
  prompt and produce sample copy, then two reviewer subagents score it on the G3 rubric.
  This is the sanctioned cheap path; the subagents are the "fresh Claude Code subagent"
  the prompt asks for.
- Page validation: import `validatePage` and run it over generated sample HTML. No model.

Run the full live pipeline ONLY when an acceptance criterion genuinely requires live output,
and log the reason in the ledger. Migrations must be applied first (see
[[unapplied-migrations-stall-pipeline]] in global memory) or research re-spends. For this
loop, no criterion requires live output: G1 is deterministic, G2 is a grep, G3 scores
sample copy.
