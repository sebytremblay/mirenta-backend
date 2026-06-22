---
name: tournament-results
description: W5 idea-tournament outcome; which structural bets graft into W2/W4 and which lose, with reasons
metadata:
  type: project
---

W5 idea tournament (Workflow 1). Five structural bets scored by two independent reviewers on the
G3 rubric. Baseline (current enterprise hero+business-case) scored 1.3. A bet adopts when it beats
baseline, carries zero blockers, and every dimension clears the floor.

**ADOPTED winners (graft into W2 copy / W4 prompts):**

1. **Shared Scar opener** (mean 7.95, min dimension 5, zero blockers) — PRIMARY hero structure.
   Two beats from ONE verified fact. Beat one names a concrete moment the lead personally lived (a
   prior build, an exit, the seed raise) drawn strictly from `research.account.recent_moves` or the
   lead executive profile. Beat two is the seller in first person admitting she lives the same stage
   right now, then why she reached out. Eyebrow names the survived moment, not role or title. Keep
   the two quick-links (#business-case, #book). Fallback chain: thin research -> drop beat one and
   open on the strongest verified company fact -> if even that is generic, revert to the standard
   product banner. Never fabricate a scar.

2. **Mirror-First ordering** (mean 7.43, zero blockers) — COMPATIBLE with Shared Scar; same family.
   Invert the hero so the first visible line mirrors the lead's own stated problem in the lead's
   framing (sourced from `account.self_description_language` plus the top priority `pov`/`why_now`),
   the second line restates the stakes, and only then the seller appears as a peer who hit the same
   wall. HARD RULE for the prompt: the first two rendered lines reference only the lead and contain
   ZERO seller or product tokens. The prospect-plus-seller lockup relocates to a slim band under the
   mirror (it still ships, so the lockup requirement and quick-links survive validation). Fallback:
   no usable self_description and no concrete priority -> revert to lockup-first, role-aware eyebrow.

   GRAFT NOTE: Shared Scar and Mirror-First combine cleanly. Lead with the lead's lived
   reality (mirror + scar), demote the seller below it, keep the lockup as a band. One hero, both
   principles.

3. **Twenty-Second Ledger** (mean 5.03, zero blockers) — PARTIAL graft into the business case.
   Insight: a founder guards hours and attention, not a windfall ROI percent. ADOPT the spirit:
   surface hours-returned and a small honest count of real conversations, use plain founder-legible
   scenario language, and respect the clock. The founder_led_sales model already computes
   `hoursReclaimed` and `timeValue`; expose them as metric tiles. REJECT the Ledger's literal
   proposal to STOP computing dollar ROI: that conflicts with G1, which requires a headline multiple
   in [1x, 20x] and a payback. Reconciliation: keep the dollar ROI MULTIPLE and payback as the
   G1-required headline (a multiple "3.2x", never a runaway percent), and ADD the hours/conversation
   figures as supporting metrics. See [[founder-led-roi-model]] for the model that already carries
   both. This reconciliation is a candidate open decision for G4 (D58 disclosure seam stays intact:
   exactly three Conservative/Expected/Aggressive scenarios).

**REJECTED losers (logged, do NOT build):**

4. **Investor-quote-section** (the W5 SEED bet; mean 5.98, mustBuild flagged, TWO blockers). Both
   reviewers killed it for the same reason: the sample put a verbatim quote in the mouth of Angela
   Strange (a real, named a16z GP) that returns zero search hits. A founder who knows the investor
   checks it in one search, finds nothing, and distrusts the whole page. The mechanism (route a
   verified investor quote through the existing D37 re-fetch pipeline) is not itself wrong, but the
   reposition must NOT add a quote-invention path or make investor quotes the default. The existing
   verified-quote pipeline already ships real quotes when they exist; leave it. T5 keeps the
   research prompt's verified-quote rigor and adds no fabrication surface. The seed bet does not survive.

5. **Peer-Proof and Trajectory** (mean 6.48, TWO blockers). Same failure: a fabricated investor
   blockquote ("We backed Cedar because Devin already proved...") attributed to an unnamed partner
   with a false "linked to the source" claim. Rejected for the same trust-killer reason as #4.

**LESSON for T4/T5 (carry into the report):** Founders trust peers and named investors far more than
vendors, but a fabricated or unverifiable quote is the single fastest way to lose all trust. The
winning bets earn trust from REAL, sourced facts about the lead (recent_moves, self-description, the
founder's own track record) and from the seller's honest first-person stage, never from invented
proof. Recognition lands as "I see the road you are on and I am walking it too," not "you are big
and important."

See [[founder-led-roi-model]], [[g2-blocklist]], [[codebase-map]].
