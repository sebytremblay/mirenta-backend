# How Mirenta Calculates Projected ROI

A walkthrough of the value model the backend runs today. Read top to bottom; no prior codebase knowledge required.

---

## The one-sentence version

For each prospect, the research agent gathers a few company facts (headcount, or rep count and deal size), the backend runs a fixed formula over those facts to produce net dollar value across three scenarios, and the website builder renders those numbers verbatim. The model never lets the AI invent a figure.

## The flow, end to end

```
RESEARCH  →  the agent fills value_inputs (e.g. total_employees) for the lead
COMPUTE   →  the backend applies a deterministic formula + fixed assumptions
RENDER    →  the builder prints the computed numbers; it recomputes nothing
VALIDATE  →  every figure must appear verbatim in the page HTML
```

Two design rules anchor the whole thing:

1. **The math lives in code, not in the prompt.** The AI gathers inputs and writes copy. It does not do arithmetic. This keeps the figures auditable and reproducible (decisions D9, D54).
2. **Every assumption is a named constant.** Win rates, deflection rates, prices, and ramps all sit in clearly labeled variables, so changing one is a deliberate, visible edit (D58).

---

## Three verticals, three behaviors

The model picks one of three "verticals" depending on what we sell to the lead.

| Vertical | Value model | Produces ROI numbers? |
|---|---|---|
| **Generic** (default) | Qualitative point of view | No. Frames a narrative, runs no math. |
| **Employee Service** (HR / ITSM) | Support-cost deflection | Yes. |
| **Sales and Marketing** (our own segment) | Pipeline uplift | Yes. |

The two quantitative verticals feed a **shared financial engine** that turns a single "gross annual value" number into net value, ROI percent, payback period, a five-year projection, and NPV.

---

## Vertical 1: Employee Service (cost deflection)

**The idea:** every employee generates support tickets that cost money to handle. The product deflects a share of them. The deflected cost is the value.

**Fixed assumptions** (`src/verticals/employee-service.ts`):

| Assumption | Value |
|---|---|
| IT tickets per employee per year | 10 |
| HR interactions per employee per year | 8 |
| Blended cost per IT ticket | $22 |
| Blended cost per HR interaction | $18 |
| Default annual license | $1.5M |
| Default implementation fee | $200K |
| Deflection rates (Conservative / Expected / Aggressive) | IT 40 / 55 / 70 percent, HR 45 / 60 / 72 percent |

**The formula:**

```
Gross savings = (employees × 10 × $22 × IT deflection)
              + (employees × 8  × $18 × HR deflection)
Net savings   = Gross savings − annual license
ROI %         = Net savings ÷ first-year cost     (license + implementation)
```

**Worked example, 20,000 employees, Expected case:**

- IT cost pool: 20,000 × 10 × $22 = $4.4M; recover 55 percent = $2.42M
- HR cost pool: 20,000 × 8 × $18 = $2.88M; recover 60 percent = $1.73M
- Gross = $4.15M, net = $4.15M − $1.5M = **$2.65M**, ROI = $2.65M ÷ $1.7M = **156 percent**

Only `total_employees` comes from research. Everything else is a fixed constant or a per-customer override.

---

## Vertical 2: Sales and Marketing (pipeline uplift)

**The idea:** the product lifts the rate at which reps book qualified meetings. More meetings become more closed-won deals. The added revenue is the value.

**Fixed assumptions** (`src/verticals/sales-marketing.ts`):

| Assumption | Value |
|---|---|
| Meeting-to-won funnel rate | 5 percent |
| Default baseline meetings per rep per year | 60 |
| Default annual license | $150K |
| Default implementation fee | $30K |
| Meeting uplift (Conservative / Expected / Aggressive) | 10 / 20 / 35 percent |

**The formula:**

```
Baseline meetings = reps × meetings per rep per year
Incremental deals  = Baseline meetings × uplift × 5% funnel rate
Gross revenue      = Incremental deals × average deal size
Net revenue        = Gross revenue − annual license
ROI %              = Net revenue ÷ first-year cost
```

**Worked example, 100 reps, $50K deal, Expected case:**

- Baseline: 100 × 60 = 6,000 meetings; uplift 20 percent = 1,200 incremental
- Deals: 1,200 × 5 percent = 60; revenue: 60 × $50K = $3.0M
- Net = $3.0M − $150K = **$2.85M**, ROI = $2.85M ÷ $180K = **1,583 percent**

Research supplies `quota_carrying_reps`, `avg_deal_size`, and optionally the baseline meeting rate.

---

## The shared financial engine

Both quantitative verticals hand their "gross annual value" to `src/verticals/financial-model.ts`, which adds the rest of the business case:

- **Payback period** = first-year cost ÷ monthly gross value.
- **Five-year cumulative**, ramped by an adoption curve of `[50%, 80%, 100%, 100%, 100%]`. Year one also absorbs the implementation fee.
- **NPV** discounted at 8 percent.

These surface on the page as four metric tiles plus an SVG bar chart of the cumulative projection.

---

## Where the numbers come from

| Input class | Source |
|---|---|
| Company facts (headcount, reps, deal size) | The research agent, into `extension.value_inputs` |
| Conversion and deflection rates | Fixed scenario constants in code |
| Pricing (license, implementation) | Defaults in code, overridable per customer (`product_profiles.economics`, D57) |
| Ticket volumes, funnel rate, adoption ramp | Fixed reference constants |

When the agent estimates a figure rather than finding it, the page carries a footnote saying so (D38).

---

## One honest caveat to discuss

The ROI **percentages run very high** (the Sales example above lands at 1,583 percent), for two structural reasons worth our attention:

1. The denominator is only the **first-year cost**, while the numerator is **full annual value**. That ratio inflates fast.
2. The Sales model applies the uplift to the **entire roster's entire meeting volume**, which likely overstates a realistic ramp.

The dollar figures are defensible blended estimates. The percentage framing deserves a sanity pass before we put it in front of buyers. This is a known item, not a bug, and a good thing to align on.

---

## The governing decisions (for the curious)

`DECISIONS.md` records the design: **D38** (estimation and disclosure), **D49** (MVP model fidelity: the fixed 10/8 volumes, three scenarios, payback, NPV, five-year), **D57** (per-customer pricing overrides), **D58** (the three verticals and the named-constant discipline).
