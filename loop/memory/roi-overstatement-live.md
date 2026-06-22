---
name: roi-overstatement-live
description: The sales_marketing ROI overstatement bug is LIVE on feat/founder-to-founder; the global-memory RESOLVED fix never landed here
metadata:
  type: project
---

The `sales_marketing` value model (`src/verticals/sales-marketing.ts`, `createCompute`)
overstates ROI badly. It multiplies a full rep roster by full baseline meetings
(`baselineMeetings = quota_carrying_reps * baseline_meetings_per_rep_year`), applies an
uplift, applies a fixed 0.05 funnel rate and the deal size, then divides net by a fixed
mid-market license (150k + 30k impl). On the self-sell Salesforce run that yields
multi-billion-dollar revenue and six-figure ROI percentages.

**Critical:** the global auto-memory `sales-marketing-roi-overstated` claims this is
RESOLVED via `price_per_seat_year`, a shared `projectFinancials` engine, and decisions
D59/D60. NONE of that exists on this branch (`feat/founder-to-founder`). A grep for
`price_per_seat_year|projectFinancials|D59|D60` returns zero matches in `src/` and
`DECISIONS.md`. That fix landed on a different branch/session. Keep the INSIGHT, discard
the false "resolved" status.

**The reusable insight (carries forward):**
1. Scope impact to the lead's span of control, not the prospect's entire funnel. An IC
   maps to 1, a leader to their team, a C-level to the org. Headcount input for a
   founder-led account is `<= 5` (G1).
2. Scale price with the same headcount the uplift uses (per-seat), so the ROI ratio does
   not explode against a fixed small license.
3. The page validator REQUIRES the computed figure to appear verbatim, so the value model
   is the single source of truth. There is no rendering-layer clamp. The bounds must hold
   in the model itself.

The founder-led reposition replaces this rep-roster model with founder-led-sales economics
(the founder's own time as the scarce input, small deal counts). See [[baseline-green]].
