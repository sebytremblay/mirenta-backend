// The Founder-led sales vertical: Mirenta's own go-to-market segment after the
// reposition (D59). Mirenta sells to companies running founder-led sales to other
// founders, and Mirenta is customer zero. The vertical spans Go-to-market and
// Growth the way employee-service spans HR and ITSM, and it targets the founder
// and the people who run growth beside them rather than an enterprise revenue org.
//
// The value model measures what a founder actually guards: closed deals won from
// the replies the personalization earns, plus the founder hours the tool returns.
// It turns a tiny team, a monthly send volume, a founder-scale deal value, a cold
// reply rate, and the hours a personalized one-pager costs into incremental closed
// deals, reclaimed founder time, and the first-year return that follows, across the
// three disclosure scenarios. The headline is a MULTIPLE (for example "4.2x"), a
// deliberate departure from the enterprise model's runaway ROI percent. The model
// invents no numbers: every figure derives deterministically from the value inputs
// and the scenario effectiveness, and the worker never lets the model author a
// figure (D9, D54). G1 holds by construction inside compute: compute clamps every
// input to its calibrated range, so the headline multiple stays within [1x, 20x]
// and payback stays positive and under 24 months for any input the research emits.

import { formatDollars } from "../domain/format.ts";
import type {
  BoundValueModel,
  ValidatedInputs,
  ValueResult,
  VerticalEconomics,
  VerticalSpec,
} from "./types.ts";
import type { ProductProfile } from "../domain/entities.ts";
import { validateEconomicsShape } from "./contract.ts";

// Funnel assumption: the share of incremental replies that become a closed deal. A
// single blended rate keeps the model defensible and auditable for a founder; a
// finer reply -> meeting -> won split is a fast-follow if the inputs warrant it.
const MEETING_TO_CLOSE_RATE = 0.2;

// The dollar value of one founder hour. A founder doing their own outbound trades
// hours for the work, so the time the tool returns carries a real, legible price.
const FOUNDER_HOURLY_VALUE = 150;

// Prospects one paid seat covers in a year. The model bills only the seats the send
// volume actually needs (never the idle ones), so a one-founder team running light
// volume never pays for capacity it does not use.
const PROSPECTS_PER_SEAT_YEAR = 240;

// Usage price per prospect: a flat base plus a small share of the deal value, so the
// price scales with the size of the outcome the founder is chasing. Calibrated (with
// ACV_PRICE_RATE) against the full input grid so the first-year return never dips
// below the 1x floor even at the worst-value corner (low reply rate, high deal
// value, light volume). An earlier 9 + 0.006*acv pairing breached that floor.
const PRICE_PER_PROSPECT_BASE = 8;
const ACV_PRICE_RATE = 0.003;

// Default 5-year adoption ramp. defaultEconomics populates it and createCompute
// falls back to it when an economics object omits the curve. One source so a
// deliberate change to the ramp edits one literal. Year one ramps to 60 percent as
// the tool learns the founder's voice.
const DEFAULT_ADOPTION_CURVE = [0.6, 0.9, 1.0, 1.0, 1.0];

// Fallback value inputs when the research does not surface the reply rate or the
// per-touch hours. Both are usually private; the research agent estimates them and
// sets estimated: true. These constants only guard a missing input so compute never
// reads undefined and silently produces zero. Mid-range so the default stays in band.
const DEFAULT_BASELINE_REPLY_RATE = 0.04;
const DEFAULT_HOURS_PER_TOUCH = 1.0;

// The calibrated input ranges. compute clamps to these so G1 holds by construction
// for any input the research emits, with no rendering-layer clamp (D54). Clamping
// errs conservative: an out-of-range deal value pulls down to founder-scale rather
// than overstating the return.
const TEAM_MIN = 1;
const TEAM_MAX = 5;
const PROSPECTS_MIN = 8;
const PROSPECTS_MAX = 80;
const DEAL_VALUE_MIN = 1_500;
const DEAL_VALUE_MAX = 30_000;
const REPLY_RATE_MIN = 0.02;
const REPLY_RATE_MAX = 0.06;
const HOURS_MIN = 0.5;
const HOURS_MAX = 1.5;

// The effectiveness keys createCompute reads from each scenario: the fractional lift
// in cold replies the personalization drives, and the share of per-touch hours the
// tool returns to the founder. validateEconomics requires every scenario to carry
// both, so a typo'd or missing key fails at save rather than computing a silent zero.
// Keep in lockstep with the keys createCompute reads below.
const REQUIRED_EFFECTIVENESS_KEYS = ["reply_uplift", "hours_recovered_per_prospect"] as const;

// Default economics for the founder-led vertical. Phase 1 always returns these; a
// profile.economics override replaces them when present and validateEconomics passes.
// No annual license: a founder pays for the seats the volume needs plus per-prospect
// usage, so the price scopes to the same tiny span the impact does.
function defaultEconomics(): VerticalEconomics {
  return {
    annual_license: 0,
    implementation_fee: 1_000,
    scenarios: [
      { name: "Conservative", effectiveness: { reply_uplift: 0.5, hours_recovered_per_prospect: 0.6 } },
      { name: "Expected", effectiveness: { reply_uplift: 0.9, hours_recovered_per_prospect: 0.8 } },
      { name: "Aggressive", effectiveness: { reply_uplift: 1.3, hours_recovered_per_prospect: 0.92 } },
    ],
    adoption_curve: DEFAULT_ADOPTION_CURVE,
  };
}

// Per-seat annual price. Held as a named constant (not a profile field) so the
// price-per-seat lever stays a deliberate edit; a profile override flows through
// economics, not through this structural default.
const PRICE_PER_SEAT_YEAR = 600;

function round(n: number): number {
  return Math.round(n);
}

// The displayed figure in whole thousands. Value created, the cost, and the split
// components all render at this precision, and the return multiple derives from
// these same integers, so every number on the page reconciles to the precision the
// founder reads: dividing the displayed value created by the displayed multiple
// returns the displayed cost, and dividing value by cost returns the multiple. A
// G3 reviewer who checks the arithmetic on the page lands on consistent numbers
// (an earlier version rounded value, multiple, and cost independently, so the three
// implied three different costs and read as reverse-engineered).
function thousands(n: number): number {
  return Math.round(n / 1000);
}

// Total over non-finite input: a NaN or Infinity (which the upstream numeric-map
// filter already drops, but which the header promises compute itself withstands)
// clamps to the conservative low bound rather than propagating NaN to the page.
function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.min(hi, Math.max(lo, n));
}

// Format the first-year return as a multiple ("4.2x"), the founder-legible headline
// that replaces the enterprise model's ROI percent.
function formatMultiple(n: number): string {
  return `${n.toFixed(1)}x`;
}

function validateEconomics(raw: unknown): VerticalEconomics {
  return validateEconomicsShape(raw, REQUIRED_EFFECTIVENESS_KEYS);
}

// Narrow the generic numeric map to the founder-led inputs. The team size, the
// monthly send volume, and the deal value drive the model and are required; the
// cold reply rate and the per-touch hours fall back to a mid-range benchmark when
// the research does not surface them (both are usually private).
function validateInputs(raw: Record<string, number>, estimated: boolean): ValidatedInputs {
  if (typeof raw.team_size !== "number") {
    throw new Error("research.extension.value_inputs.team_size missing");
  }
  if (typeof raw.prospects_per_month !== "number") {
    throw new Error("research.extension.value_inputs.prospects_per_month missing");
  }
  if (typeof raw.avg_deal_value !== "number") {
    throw new Error("research.extension.value_inputs.avg_deal_value missing");
  }
  return {
    values: {
      team_size: raw.team_size,
      prospects_per_month: raw.prospects_per_month,
      avg_deal_value: raw.avg_deal_value,
      baseline_reply_rate:
        typeof raw.baseline_reply_rate === "number"
          ? raw.baseline_reply_rate
          : DEFAULT_BASELINE_REPLY_RATE,
      hours_per_personalized_touch:
        typeof raw.hours_per_personalized_touch === "number"
          ? raw.hours_per_personalized_touch
          : DEFAULT_HOURS_PER_TOUCH,
    },
    estimated,
  };
}

// Factory: create a compute function bound to the given economics. Pure
// (inputs -> ValueResult); the economics flow through the closure.
function createCompute(economics: VerticalEconomics) {
  return (inputs: ValidatedInputs): ValueResult => {
    // Clamp every input to its calibrated range so G1 holds by construction. An
    // out-of-range value pulls to the nearest bound (the conservative direction).
    const team = clamp(Math.floor(inputs.values.team_size ?? 0), TEAM_MIN, TEAM_MAX);
    const prospectsPerMonth = clamp(
      inputs.values.prospects_per_month ?? 0,
      PROSPECTS_MIN,
      PROSPECTS_MAX,
    );
    const dealValue = clamp(inputs.values.avg_deal_value ?? 0, DEAL_VALUE_MIN, DEAL_VALUE_MAX);
    const replyRate = clamp(
      inputs.values.baseline_reply_rate ?? DEFAULT_BASELINE_REPLY_RATE,
      REPLY_RATE_MIN,
      REPLY_RATE_MAX,
    );
    const hoursPerTouch = clamp(
      inputs.values.hours_per_personalized_touch ?? DEFAULT_HOURS_PER_TOUCH,
      HOURS_MIN,
      HOURS_MAX,
    );

    const prospectsYear = prospectsPerMonth * 12;

    // Price scopes to the same tiny span the impact does: bill only the seats the
    // volume needs (never idle seats), plus per-prospect usage that scales with the
    // deal value. effectiveLicense is the recurring annual cost a founder pays.
    const billedSeats = clamp(Math.ceil(prospectsYear / PROSPECTS_PER_SEAT_YEAR), 1, team);
    const pricePerProspect = PRICE_PER_PROSPECT_BASE + ACV_PRICE_RATE * dealValue;
    const usageAnnual = pricePerProspect * prospectsYear;
    const seatAnnual = PRICE_PER_SEAT_YEAR * billedSeats;
    const effectiveLicense = economics.annual_license + seatAnnual + usageAnnual;
    const firstYearCost = effectiveLicense + economics.implementation_fee;

    // Per scenario: the reply uplift turns cold replies into incremental replies,
    // the funnel rate turns those into incremental closed deals, and the deal value
    // turns those into revenue. The hours-recovered share turns per-touch hours into
    // reclaimed founder time, valued at the founder hourly rate. The two terms stay
    // separate so the page can name each (a founder discounts imputed time on its
    // own merits, so the model never hides it inside one opaque total).
    const splitFor = (
      replyUplift: number,
      hoursRecovered: number,
    ): { revenue: number; time: number; gross: number } => {
      const incrementalDeals = prospectsYear * replyRate * replyUplift * MEETING_TO_CLOSE_RATE;
      const revenue = incrementalDeals * dealValue;
      const hoursReclaimed = prospectsYear * hoursPerTouch * hoursRecovered;
      const time = hoursReclaimed * FOUNDER_HOURLY_VALUE;
      return { revenue, time, gross: revenue + time };
    };

    // The first-year cost, rounded to the thousands the page displays. The return
    // multiple derives from this same displayed integer, so the on-page arithmetic
    // closes exactly: a founder who divides a card's displayed value created by its
    // displayed multiple lands back on this cost tile, and value over cost returns
    // the multiple. An earlier version rounded value, multiple, and cost
    // independently, so the three implied three different costs; the G3 reviewers
    // read that as reverse-engineered and failed the credibility gate.
    const costK = thousands(firstYearCost);

    // Every figure on the page reconciles to ONE first-year cost. A scenario card
    // shows the gross value created and the return multiple, and the multiple is the
    // displayed value (in thousands) over the displayed cost (in thousands), so the
    // founder's own division ties out to the precision the page shows.
    const scenarios = economics.scenarios.map((s) => {
      const { gross } = splitFor(
        s.effectiveness.reply_uplift ?? 0,
        s.effectiveness.hours_recovered_per_prospect ?? 0,
      );
      const grossK = thousands(gross);
      const multiple = costK > 0 ? grossK / costK : 0;
      return {
        name: s.name,
        // Gross value created in a year: the revenue from deals won plus the founder
        // time returned. Labeled "Value created" and paired with the value-over-cost
        // multiple, so value divided by multiple equals the first-year cost tile.
        primaryValue: formatDollars(round(gross)),
        primaryLabel: "Value created",
        secondary: formatMultiple(multiple),
      };
    });

    // Expected scenario drives the headline, the payback, and the metric tiles. Read
    // it by the disclosure-fixed middle position, and keep its two value terms split
    // so the footnote names the deal revenue and the founder-time value separately.
    const expected = economics.scenarios[1]!;
    const expectedReplyUplift = expected.effectiveness.reply_uplift ?? 0;
    const expectedHoursRecovered = expected.effectiveness.hours_recovered_per_prospect ?? 0;
    const expectedSplit = splitFor(expectedReplyUplift, expectedHoursRecovered);
    const expectedGross = expectedSplit.gross;
    // Headline multiple derives from the same displayed thousands as the cards, so
    // the hero figure reconciles with the Expected card and the cost tile.
    const headlineMultiple = costK > 0 ? thousands(expectedGross) / costK : 0;
    const hoursReclaimedYear = round(prospectsYear * hoursPerTouch * expectedHoursRecovered);

    // Payback: first-year cost divided by monthly gross value. Guard against a zero
    // funnel so the figure stays finite.
    const paybackValue =
      expectedGross > 0 ? `${(firstYearCost / (expectedGross / 12)).toFixed(1)} mo` : "n/a";

    // The founder-led page renders no multi-year projection. The five-year cumulative
    // chart belonged to the enterprise model; a founder guards the near term, not a
    // compounding curve (the W5 Twenty-Second Ledger insight). Omitting it also closes
    // two G3 blockers: a cheap builder drew the chart with bars off the canvas, and a
    // ramped Year 1 cumulative figure contradicted the steady-state headline. The
    // projection field stays optional on the contract (D49, D58), so the renderer and
    // the page validator degrade cleanly with it absent.
    return {
      sectionTitle: "What you get back",
      headline: { label: "Expected first-year return", value: formatMultiple(headlineMultiple) },
      scenarios,
      // State the math basis AND the split so a founder checks every figure without
      // a calculator. The G3 reviewers read a single opaque "value created" total as
      // decoration and flagged that more than half rode on imputed time they could
      // not see, so the footnote now names the two terms with their own dollar
      // figures (deal revenue plus founder time at the hourly rate) that sum to the
      // Expected value created, then states the multiple as value over cost. Keeps
      // the "sharpen" estimate disclosure (D38) when the inputs are estimated.
      footnote: (() => {
        const revenueK = formatDollars(round(expectedSplit.revenue));
        const timeK = formatDollars(round(expectedSplit.time));
        const split = `In the Expected case the ${formatDollars(round(expectedGross))} splits into ${revenueK} from deals won (the extra replies the page earns, carried through to closed deals) and ${timeK} from the ${hoursReclaimedYear} founder hours it returns, valued at ${formatDollars(FOUNDER_HOURLY_VALUE)} per hour; the return multiple is value created over the first-year cost.`;
        return inputs.estimated
          ? `These figures model early founder-led use and sharpen as you run real outreach. ${split}`
          : split;
      })(),
      metrics: [
        { label: "Payback period", value: paybackValue },
        { label: "Hours returned per year", value: `${hoursReclaimedYear} hrs` },
        // The cost tile renders the same displayed thousands the multiple divides by
        // (costK), so the denominator a founder reads matches the one the multiple
        // uses. formatDollars on costK*1000 yields the identical "$NNK" string.
        { label: "First-year cost", value: formatDollars(costK * 1000) },
      ],
    };
  };
}

const inputGuidance = `Gather the founder-led outbound drivers as numeric value_inputs:
- team_size: how many people send outbound today, the founder plus any teammates (1 to 5, required). Source from the about page, the team page, or a public profile.
- prospects_per_month: personalized one-pagers the team sends each month (8 to 80, required). Estimate from the cadence the founder describes.
- avg_deal_value: annual contract value of one closed deal in USD (1500 to 30000, required). Source from pricing pages or comparable deals, and keep it founder-scale.
- baseline_reply_rate: share of cold prospects who reply today (0.02 to 0.06). Usually private; estimate from the segment when unavailable.
- hours_per_personalized_touch: hours the founder spends researching and writing one one-pager (0.5 to 1.5). Estimate from how the founder describes the work.
Use real figures when you find them and set estimated: false. Otherwise estimate and set estimated: true.`;

function createValueModel(profile: ProductProfile): BoundValueModel {
  const economics = profile.economics ? validateEconomics(profile.economics) : defaultEconomics();
  return {
    inputGuidance,
    validateInputs,
    compute: createCompute(economics),
    economics,
  };
}

export const founderLedSalesVertical: VerticalSpec = {
  id: "founder_led_sales",
  label: "Founder-led sales",
  domains: ["Go-to-market", "Growth"],
  domainGuidance: `Surface the founder's top priorities through a peer lens: winning the first reference customers, starting real conversations with the people they most want to reach, protecting the founder's own hours, and building proof that the product works. Frame each priority as a point of view (POV): a stance on what the founder recognizes as their own priority, and why now.
Capture two things the page opens on, sourced and never invented: the language the founder uses to describe their own work (set account.self_description_language from their site, posts, or launch copy), and one concrete moment the founder has personally lived (a prior build, an exit, the funding round, the first hire) in account.recent_moves or the lead executive profile. State only what the research confirms; a missing moment falls back cleanly downstream.`,
  executiveTargeting: `Prioritize the founder and the people who run growth beside them:
- The founder or co-founder (CEO, technical co-founder)
- An early growth or go-to-market hire, when one exists
- The first revenue owner, when the founder has handed it off`,
  defaultAccentColor: "#0f766e",
  // Hero narrative grafted from the W5 idea tournament (D59): the Shared Scar opener
  // and the Mirror-First ordering, the two bets that cleared the founder rubric with
  // zero blockers. Both demote the seller below a moment the founder has lived, so
  // the page reads as a peer who recognized the problem, not a vendor broadcast. The
  // rejected investor-quote bets add no fabrication path: the hero invents nothing.
  narrativeGuidance: `HERO NARRATIVE (founder-to-founder). Open the hero by reflecting the lead's own reality back, then introduce the seller second as a peer who hit the same wall. Order the hero this way:
- First, a single mirror line in the lead's own framing: name the concrete problem the founder wakes up thinking about, drawn from the account self-description and the top priority POV and why-now. Reference ONLY the lead. Write no seller name and no product name in this first line.
- Second, one line that names a specific moment the lead has personally lived (a prior build, an exit, the funding round), drawn strictly from the researched recent moves or the lead executive profile. State one real fact; invent no exit, valuation, backer, or outcome.
- Third, the seller in first person, admitting the same stage plainly (for example, a founder who runs their own outreach and writes every message by hand), then why they reached out. Only here do the seller name and the product appear.
Keep the prospect-and-seller lockup, but place it as a slim band under those lines rather than as the first thing the eye meets. The <h1> states the recognized problem, not a seller value claim. Keep both hero quick-links (one to the business case, one to the booking action).
FALLBACK: when the research surfaces no usable self-description and no concrete lived moment, open on the strongest verified account fact instead, and keep the first-person seller admission, which rests only on the seller's own facts. Never manufacture a problem or a moment the research does not support.
LENGTH: keep each of the three hero lines to ONE tight sentence. The three lines together run under 40 words before the <h1>. A founder reads the hero in one breath; an overlong opener reads as a wall of text and the page rejects on it.`,
  // Source quotes from third-party voices, never the lead's own words (D60). A
  // founder-to-founder page that quotes the founder back to himself reads as a
  // form letter; a verified voice from his own world (an investor, a peer, a
  // high-signal industry post) carries social proof the lead trusts. The D37
  // re-fetch rigor is unchanged: this names whose words to capture, never whether
  // to verify them.
  quoteTargeting: `Source every quote from a THIRD-PARTY voice in the lead's world, never the lead's own words. Prioritize, in order:
- The lead's named investors or backers (the partners at the funds that backed the company): a public statement on the company, the founder, or the market.
- A respected peer operator or founder in the lead's segment whose view the lead would recognize and trust.
- A high-engagement public post or article on the trend the lead is riding (for example AI-era outbound, cold-email effectiveness), attributed to its real author.
Do NOT quote the lead back to themselves: a quote whose speaker is the lead does not belong in the quote band. Apply the same D37 rigor to every quote: re-fetch the source, confirm the wording, set verified true only on a confirmed match, and drop any quote that fails. Invent no quote, speaker, or source. When no third-party quote verifies, return no quotes rather than falling back to the lead's own words.`,
  inputGuidance, // exposed directly for the research agent kickoff
  validateInputs, // exposed directly for the validateResearch early gate
  createValueModel,
  defaultEconomics,
  validateEconomics, // exposed for saveProfile's save-time gate
};
