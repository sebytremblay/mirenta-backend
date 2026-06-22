---
name: founder-led-roi-model
description: The frozen founder-led ROI value-model design and G1 numbers that replace the rep-roster sales_marketing model
metadata:
  type: project
---

The founder-led ROI model that replaces the rep-roster `sales_marketing` model. Designed and
verified across 30 sampled inputs (22 plausible + 8 stressors); every case holds the G1 bounds by
construction inside `compute` (there is no rendering-layer clamp; the page validator requires every
figure verbatim, see [[roi-overstatement-live]]). Model id: `founder_led_sales`.

**FROZEN G1 NUMBERS (the harness asserts these):**
- headline ROI multiple in [1x, 20x] (observed band across samples: [1.47, 5.21])
- payback months: positive finite, <= 24 (observed max: 8.2)
- team_size (headcount) input <= 5; compute clamps to [1,5] regardless
- every headline figure named and sourced (no figure without a traceable derivation)

**INPUTS (value_inputs, all numeric):**
- team_size (1-5): founder plus tiny team; scopes BOTH impact and price. Clamped [1,5] in compute.
- prospects_per_month (8-80): personalized one-pagers sent per month.
- avg_deal_value ($1.5k-$30k): annual contract value of one closed deal.
- baseline_reply_rate (0.02-0.06): share of cold prospects that reply -> meeting today.
- hours_per_personalized_touch (0.5-2.0): hours the founder spends researching+writing one one-pager.

**MODULE CONSTANTS (model structure, NOT economics; named like employee-service deflection consts):**
- MEETING_TO_CLOSE_RATE = 0.20
- FOUNDER_HOURLY_VALUE = 150
- PROSPECTS_PER_SEAT_YEAR = 240
- price_per_prospect_base = 9
- acv_price_rate = 0.006

**DEFAULT ECONOMICS (tunable per-customer; validateEconomics requires the two effectiveness keys):**
- annual_license = 0, implementation_fee = 1000, price_per_seat_year = 600
- scenarios (names fixed Conservative/Expected/Aggressive, D49):
  - Conservative: reply_uplift 0.5, hours_recovered_per_prospect 0.6
  - Expected:     reply_uplift 0.9, hours_recovered_per_prospect 0.8
  - Aggressive:   reply_uplift 1.3, hours_recovered_per_prospect 0.92
- effectivenessKeys (REQUIRED_EFFECTIVENESS_KEYS): ["reply_uplift", "hours_recovered_per_prospect"]
- adoption_curve default [0.6, 0.9, 1.0, 1.0, 1.0]

**FORMULA (compute, pure/deterministic):**
```
team          = min(5, max(1, floor(team_size)))
prospectsYear = prospects_per_month * 12
// per scenario s:
incrementalDeals = prospectsYear * baseline_reply_rate * s.reply_uplift * MEETING_TO_CLOSE_RATE
revenueGain      = incrementalDeals * avg_deal_value
hoursReclaimed   = prospectsYear * hours_per_personalized_touch * s.hours_recovered_per_prospect
timeValue        = hoursReclaimed * FOUNDER_HOURLY_VALUE
grossAnnual      = revenueGain + timeValue
// price scopes to the SAME span; idle seats never billed:
billedSeats      = min(team, max(1, ceil(prospectsYear / PROSPECTS_PER_SEAT_YEAR)))
pricePerProspect = price_per_prospect_base + acv_price_rate * avg_deal_value
usageAnnual      = pricePerProspect * prospectsYear
seatAnnual       = price_per_seat_year * billedSeats
effectiveLicense = annual_license + seatAnnual + usageAnnual
firstYearCost    = effectiveLicense + implementation_fee
net(s)           = grossAnnual(s) - effectiveLicense
roiMultiple(s)   = firstYearCost > 0 ? grossAnnual(s) / firstYearCost : 0   // a MULTIPLE (e.g. "3.2x"), not a fantasy %
headlineMultiple = roiMultiple(Expected)
paybackMonths    = grossAnnual(Expected) > 0 ? firstYearCost / (grossAnnual(Expected)/12) : "n/a"
// 5-year cumulative under the ramp; year 1 absorbs implementation_fee; usage cost ramps with volume:
for i in adoption_curve: grossY = ramp[i]*grossAnnual(Expected);
  costY = seatAnnual + ramp[i]*usageAnnual + (i==0 ? implementation_fee : 0);
  running += grossY - costY; series[i] = {period:"Year i+1", value:round(running), display:formatDollars(...)}
```
All figures pass formatDollars before render; payback formatted "X.X mo"; the headline is a MULTIPLE
("3.2x"), a deliberate departure from the enterprise model's runaway ROI percent.

**DECISION IMPACT (for G4):**
- NEW decision (next free id, likely D59): record the founder-led reposition. Not a conflict.
- D58: its sales_marketing rep-roster mechanism is replaced; spec id/label/domain span/disclosure
  compliance survive. The deliberate edit D58 anticipated, generalized to a model swap. Not a conflict.
- D57: honored unchanged. Factory + validateEconomics + defaultEconomics preserved; per-seat price is
  the economics lever; structural constants stay in code.
- D58 open item (hardcoded scenario names) still relied on; the model complies, raises no new conflict.

**RISKS (carry into the report):** reply_rate and hours are usually estimated -> footnote fires;
surface inputs on the page so a founder can re-derive. Structural constants are code edits, not
profile edits. ACV above ~$30k is out of the calibrated range; research guidance must keep deal value
founder-scale. Activity-based billed seats make the raw seat count less legible; show effective
first-year cost, not seat count.

See [[codebase-map]] for the seam this fits and [[baseline-green]] for test conventions.
